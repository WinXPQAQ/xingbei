"""Persistent simulator pool and batched inference; policy fixed for a rollout."""
import asyncio
import json
import pathlib

import torch
from model import SeatMemory, batch
from encoding_candidate import seat_memory

WORKER = pathlib.Path(__file__).with_name('worker.mjs')
SAMPLING_VERSION = 2


def sample_legal(probabilities, count, generator):
    # multinomial consumes RNG for every supplied category, including zero
    # padding. Slice first so another game's candidate count cannot affect RNG.
    return torch.multinomial(probabilities[:count].cpu(), 1, generator=generator).item()


class Simulator:
    async def start(self):
        self.process = await asyncio.create_subprocess_exec('node', str(WORKER),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE, limit=16 * 1024 * 1024)
        return self

    async def send(self, value):
        self.process.stdin.write((json.dumps(value) + '\n').encode())
        await self.process.stdin.drain()

    async def read(self):
        line = await self.process.stdout.readline()
        if not line:
            raise RuntimeError((await self.process.stderr.read()).decode())
        message = json.loads(line)
        if message['type'] == 'error':
            raise RuntimeError(message['error'])
        return message

    async def close(self):
        if self.process.returncode is None:
            self.process.terminate()
        await self.process.wait()


async def collect(model, configs, workers, device, teacher=None, greedy=False, retain=True, on_result=None, execute_teacher=True):
    jobs, requests = asyncio.Queue(), asyncio.Queue()
    for config in configs:
        jobs.put_nowait(config)
    records, results = [], []
    inference_batches = []
    model.eval()

    async def play():
        simulator = await Simulator().start()
        try:
            while not jobs.empty():
                config = jobs.get_nowait()
                memory, trajectory = seat_memory(model.feature_encoding), []
                generator = torch.Generator().manual_seed(config['seed'] ^ config.get('samplingSeed', 0))
                await simulator.send({'type': 'start', 'config': config, 'teacher': teacher,
                                      'seatPolicies': config.get('seatPolicies')})
                while True:
                    message = await simulator.read()
                    if message['type'] == 'result':
                        result = message['result']
                        result.update({key: config[key] for key in ('lineup', 'team', 'mode', 'arm', 'heroIds', 'samplingSeed') if key in config})
                        result['seatPolicies'] = config.get('seatPolicies', ['model'] * 6)
                        results.append(result)
                        if on_result:
                            on_result(result)
                        # Truncated episodes receive no invented reward or update.
                        # Report their exclusion explicitly; high truncation invalidates a pilot.
                        if result['terminated']:
                            for row in trajectory:
                                row['return'] = result['rewards'][str(row['seat'])]
                            records.extend(trajectory)
                        break
                    assert message['type'] == 'decision'
                    state, actions = memory.encode(message['seat'], message['observation'])
                    row = {'state': state, 'actions': actions, 'seat': message['seat'], 'seed': config['seed'],
                           'kind': message['observation']['request']['type']}
                    if teacher:
                        row['teacherChoice'] = message['teacher']
                        if not isinstance(row['teacherChoice'], int):
                            raise RuntimeError('Missing explicit teacher label')
                    if teacher and execute_teacher:
                        index = row['teacherChoice']
                    else:
                        future = asyncio.get_running_loop().create_future()
                        await requests.put((row, future, generator))
                        index, logp, value = await future
                        row.update(logp=logp, value=value)
                    row['choice'] = index
                    if retain:
                        trajectory.append(row)
                    await simulator.send({'type': 'select', 'id': message['id'], 'index': index})
        finally:
            await simulator.close()

    tasks = [asyncio.create_task(play()) for _ in range(min(workers, len(configs)))]
    try:
        while not all(task.done() for task in tasks):
            # Never hang silently if a simulator has failed while others wait.
            for task in tasks:
                if task.done() and task.exception():
                    raise task.exception()
            try:
                first = await asyncio.wait_for(requests.get(), timeout=0.01)
            except TimeoutError:
                continue
            pending = [first]
            await asyncio.sleep(0.001)
            while not requests.empty():
                pending.append(requests.get_nowait())
            with torch.inference_mode():
                logits, values = model(*batch([row for row, _, _ in pending], device))
                distribution = torch.distributions.Categorical(logits=logits)
                # Per-game random streams do not depend on OS worker scheduling.
                choices = logits.argmax(-1) if greedy else torch.tensor([
                    sample_legal(distribution.probs[index], len(row['actions']), generator)
                    for index, (row, _, generator) in enumerate(pending)], device=device)
                probabilities = distribution.log_prob(choices)
            inference_batches.append(len(pending))
            for index, (_, future, _) in enumerate(pending):
                future.set_result((choices[index].item(), probabilities[index].item(), values[index].item()))
        await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
    records.sort(key=lambda row: row['seed'])
    results.sort(key=lambda result: result['seed'])
    return records, results, inference_batches
