"""Persistent simulators sharing a batched policy. No state shared between seats.

The queue holds detached observations only. The Node workers retain commands,
rule state and legal-candidate ordering. Useful for evaluation and later rollout.
"""
import asyncio
import json
from pathlib import Path
import time
import torch
from model import SCHEMA, collate

ROOT = Path(__file__).resolve().parents[2]
ROSTERS = [
    ['berserker', 'windSwordmaster', 'marksman', 'sealer', 'guardianAngel', 'priest'],
    ['saint', 'holyLancer', 'plagueMage', 'elementalist', 'valkyrie', 'magicalGirl'],
    ['assassin', 'magicSwordsman', 'adjudicator', 'sage', 'prayer', 'heroicPuppet'],
]


async def run_games(model, vocabulary, configs, *, workers=4, device='cpu', opponent=None,
                    sparse=True, batch_wait_ms=1, trajectory=False):
    if workers < 1 or not configs: raise ValueError('Need workers and game configs')
    jobs = asyncio.Queue()
    for index, config in enumerate(configs): jobs.put_nowait((index, config))
    pending = asyncio.Queue()
    results = [None] * len(configs)
    stats = dict(decisions=0, candidates=0, bytes=0, batches=0, max_batch=0,
                 collate_seconds=0., infer_seconds=0., parse_seconds=0.)
    model.to(device).eval()
    processes = []

    async def send(process, message):
        process.stdin.write((json.dumps(message, separators=(',', ':')) + '\n').encode())
        await process.stdin.drain()

    async def simulator():
        process = await asyncio.create_subprocess_exec('node', 'training/worker.mjs', cwd=ROOT,
                    stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, limit=32*1024*1024)
        processes.append(process)
        while not jobs.empty():
            try: index, config = jobs.get_nowait()
            except asyncio.QueueEmpty: break
            # Mirror model side across games; protocol does not infer strength
            # from this small throughput sample.
            moves = []
            red = index % 2 == 0
            policies = ['model' if opponent is None or ((seat in [0,3,4]) == red) else opponent for seat in range(6)]
            await send(process, dict(type='start', schema=SCHEMA, config=config, seatPolicies=policies,
                **(dict(wire='sparse-v1', vocabulary=vocabulary.symbols) if sparse else {})))
            while True:
                line = await process.stdout.readline()
                if not line: raise RuntimeError(f'Simulator exited: {process.returncode}')
                stats['bytes'] += len(line)
                start = time.perf_counter(); message = json.loads(line); stats['parse_seconds'] += time.perf_counter()-start
                if message['type'] == 'error': raise RuntimeError(message['error'])
                if message['type'] == 'result':
                    results[index] = message['result']
                    if trajectory: results[index]['trajectory'] = moves
                    break
                future = asyncio.get_running_loop().create_future()
                await pending.put((message['observation'], future))
                selection = await future
                if trajectory:
                    moves.append(dict(observation=message['observation'], seat=message['seat'], **selection))
                    choice = selection['choice']
                else: choice = selection
                await send(process, dict(type='select', id=message['id'], index=choice))

    async def infer():
        while True:
            items = [await pending.get()]
            if batch_wait_ms: await asyncio.sleep(batch_wait_ms / 1000)
            while not pending.empty(): items.append(pending.get_nowait())
            observations = [item[0] for item in items]
            start = time.perf_counter()
            batch = collate(observations, vocabulary, device)
            if device == 'cuda': torch.cuda.synchronize()
            stats['collate_seconds'] += time.perf_counter()-start
            start = time.perf_counter()
            with torch.inference_mode():
                if trajectory:
                    logits, values = model(batch)
                    distribution = torch.distributions.Categorical(logits=logits)
                    selected = distribution.sample()
                    choices = [dict(choice=choice, old_log_prob=logp, old_value=value)
                               for choice, logp, value in zip(selected.tolist(), distribution.log_prob(selected).tolist(), values.tolist())]
                else: choices = model.policy_logits(batch).argmax(-1).tolist()
            stats['infer_seconds'] += time.perf_counter()-start
            stats['batches'] += 1; stats['decisions'] += len(items)
            stats['candidates'] += sum(len(o['candidates']) for o in observations)
            stats['max_batch'] = max(stats['max_batch'], len(items))
            for (_, future), choice in zip(items, choices): future.set_result(choice)

    start = time.perf_counter()
    inference = asyncio.create_task(infer())
    simulations = [asyncio.create_task(simulator()) for _ in range(min(workers, len(configs)))]
    all_done = asyncio.gather(*simulations)
    try:
        done, _ = await asyncio.wait([all_done, inference], return_when=asyncio.FIRST_COMPLETED)
        for task in done: task.result()  # Propagate inference errors instead of hanging workers.
        await all_done
    finally:
        for task in simulations: task.cancel()
        inference.cancel()
        await asyncio.gather(all_done, *simulations, inference, return_exceptions=True)
        for process in processes:
            if process.returncode is None: process.terminate()
        await asyncio.gather(*(process.wait() for process in processes))
    stats['seconds'] = time.perf_counter()-start
    stats['games_per_second'] = len(results)/stats['seconds']
    stats['decisions_per_second'] = stats['decisions']/stats['seconds']
    stats['mean_batch'] = stats['decisions']/max(1, stats['batches'])
    return dict(results=results, stats=stats)


if __name__ == '__main__':
    import argparse
    from model import EntityPolicy
    parser = argparse.ArgumentParser()
    parser.add_argument('checkpoint')
    parser.add_argument('--games', type=int, default=12)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--device', default='cpu')
    parser.add_argument('--opponent', default=None)
    parser.add_argument('--raw', action='store_true')
    parser.add_argument('--output')
    parser.add_argument('--profile', action='store_true')
    args = parser.parse_args()
    if args.games < 1 or args.workers < 1: parser.error('games and workers must be positive')
    torch.set_num_threads(2)
    model, vocabulary = EntityPolicy.restore(torch.load(args.checkpoint, map_location='cpu', weights_only=False))
    configs = [dict(seed=211102300+i, heroIds=ROSTERS[i % 3], start=i % 6, profile=args.profile) for i in range(args.games)]
    report = asyncio.run(run_games(model, vocabulary, configs, workers=args.workers, device=args.device,
                                  opponent=args.opponent, sparse=not args.raw))
    text = json.dumps(report, indent=2)
    if args.output:
        with open(args.output, 'x') as file: file.write(text + '\n')
    print(json.dumps(report['stats'], indent=2))
