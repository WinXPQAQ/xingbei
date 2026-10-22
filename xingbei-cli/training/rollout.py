"""Persistent simulator pool and batched inference; policy fixed for a rollout."""
import asyncio
import json
import math
import pathlib

import torch
from model import SeatMemory, batch
from encoding_candidate import seat_memory
from exploration import exploration_bias, proposal_logits

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


async def collect(model, configs, workers, device, teacher=None, greedy=False, retain=True, on_result=None, execute_teacher=True, on_choice=None, temperature=1.0, targeted_exploration=False, actor_models=None):
    if not math.isfinite(temperature) or temperature <= 0:
        raise ValueError("Sampling temperature must be finite and positive")
    if targeted_exploration and greedy:
        raise ValueError("Training exploration must not affect greedy evaluation")
    networks = actor_models or {'model': model}
    if actor_models and (retain or not greedy or teacher or targeted_exploration):
        raise ValueError('Multi-model routing is evaluation-only')
    if any(net.feature_encoding != model.feature_encoding or net.baseline_version != model.baseline_version for net in networks.values()):
        raise ValueError('Multi-model evaluation requires matching observation/baseline interfaces')
    jobs, requests = asyncio.Queue(), asyncio.Queue()
    for config in configs:
        jobs.put_nowait(config)
    records, results = [], []
    inference_batches = []
    for net in networks.values():
        net.eval()

    async def play():
        simulator = await Simulator().start()
        try:
            while not jobs.empty():
                config = jobs.get_nowait()
                memory, trajectory = seat_memory(model.feature_encoding), []
                decision_diagnostics = {}
                baseline_decisions = baseline_matches = baseline_nonforced = 0
                generator = torch.Generator().manual_seed(config['seed'] ^ config.get('samplingSeed', 0))
                await simulator.send({'type': 'start', 'config': config, 'teacher': teacher,
                                      'baseline': getattr(model, 'baseline_version', None), 'seatPolicies': ['model' if policy in networks else policy for policy in config.get('seatPolicies', ['model'] * 6)]})
                while True:
                    message = await simulator.read()
                    if message['type'] == 'result':
                        result = message['result']
                        result['decisionDiagnostics'] = decision_diagnostics
                        if getattr(model, 'baseline_version', None):
                            result['baselineDecisions'] = baseline_decisions
                            result['baselineMatches'] = baseline_matches
                            result['baselineNonforced'] = baseline_nonforced
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
                           'kind': message['observation']['request']['type'], 'temperature': temperature}
                    row['actorPolicy'] = config.get('seatPolicies', ['model'] * 6)[message['seat']]
                    if targeted_exploration:
                        row['explorationBias'] = exploration_bias(message['observation'])
                    if getattr(model, 'baseline_version', None):
                        row['baselineChoice'] = message['baseline']
                        if not isinstance(row['baselineChoice'], int):
                            raise RuntimeError('Missing required baseline choice')
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
                    if 'baselineChoice' in row:
                        baseline_decisions += 1
                        baseline_matches += int(index == row['baselineChoice'])
                        baseline_nonforced += int(len(actions) > 1)
                    hints = exploration_bias(message['observation'])
                    hero = message['observation']['players'][0]['hero']
                    counts = decision_diagnostics.setdefault(hero, {'refineOpportunities': 0, 'refineChosen': 0,
                        'baselineRefineChosen': 0, 'roarPreserveOpportunities': 0, 'inactiveRoarChosen': 0,
                        'baselineInactiveRoarChosen': 0})
                    if any(value > 0 for value in hints):
                        counts['refineOpportunities'] += 1
                        counts['refineChosen'] += int(hints[index] > 0)
                        counts['baselineRefineChosen'] += int(hints[message['baseline']] > 0) if message.get('baseline') is not None else 0
                    if any(value < 0 for value in hints):
                        counts['roarPreserveOpportunities'] += 1
                        counts['inactiveRoarChosen'] += int(hints[index] < 0)
                        counts['baselineInactiveRoarChosen'] += int(hints[message['baseline']] < 0) if message.get('baseline') is not None else 0
                    row['choice'] = index
                    if on_choice is not None:
                        on_choice(message['observation'], row)
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
            groups = {}
            for item in pending:
                groups.setdefault(item[0]['actorPolicy'], []).append(item)
            for policy, group in groups.items():
                with torch.inference_mode():
                    logits, values = networks[policy](*batch([row for row, _, _ in group], device))
                    distribution = torch.distributions.Categorical(logits=proposal_logits(
                        logits, [row for row, _, _ in group], torch.full((len(group),), temperature, device=device)))
                    choices = logits.argmax(-1) if greedy else torch.tensor([
                        sample_legal(distribution.probs[index], len(row['actions']), generator)
                        for index, (row, _, generator) in enumerate(group)], device=device)
                    probabilities = distribution.log_prob(choices)
                inference_batches.append(len(group))
                for index, (_, future, _) in enumerate(group):
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
