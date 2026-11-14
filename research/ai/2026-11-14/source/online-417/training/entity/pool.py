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
from wire import WireDecoder
from binary_wire import decode_tensor
try:
    from orjson import loads as load_json
except ImportError:
    from json import loads as load_json

ROOT = Path(__file__).resolve().parents[2]
ROSTERS = [
    ['berserker', 'windSwordmaster', 'marksman', 'sealer', 'guardianAngel', 'priest'],
    ['saint', 'holyLancer', 'plagueMage', 'elementalist', 'valkyrie', 'magicalGirl'],
    ['assassin', 'magicSwordsman', 'adjudicator', 'sage', 'prayer', 'heroicPuppet'],
]


async def run_games(model, vocabulary, configs, *, workers=16, device='cpu', opponent=None,
                    sparse=True, batch_wait_ms=0, trajectory=False, models=None, delta=True, binary=False,
                    opponent_temperature=0.0, evaluation_temperature=0.0):
    if workers < 1 or not configs: raise ValueError('Need workers and game configs')
    if not 0 <= opponent_temperature < float('inf'):
        raise ValueError('Invalid opponent temperature')
    if not 0 <= evaluation_temperature < float('inf'):
        raise ValueError('Invalid evaluation temperature')
    jobs = asyncio.Queue()
    for index, config in enumerate(configs): jobs.put_nowait((index, config))
    pending = asyncio.Queue()
    results = [None] * len(configs)
    stats = dict(decisions=0, candidates=0, bytes=0, batches=0, max_batch=0,
                 collate_seconds=0., infer_seconds=0., collate_infer_seconds=0., parse_seconds=0.,
                 decode_seconds=0., reused_prefixes=0, model_decisions={},
                 timing_semantics='Host wall-clock phases. Combined collation and inference ends after results return to CPU.')
    networks = {'current':(model,vocabulary), **(models or {})}
    for network,_ in networks.values(): network.to(device).eval()
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
            decoder = WireDecoder()
            red = index % 2 == 0
            rival = config.get('opponent', opponent)
            policies = ['model' if rival is None or rival == 'self' or ((seat in [0,3,4]) == red) else rival for seat in range(6)]
            await send(process, dict(type='start', schema=SCHEMA, config=config, seatPolicies=policies,
                **(dict(wire='tensor-v1' if binary else 'sparse-delta-v1' if delta else 'sparse-v1', vocabulary=vocabulary.symbols, vocabularies={key:v.symbols for key,(_,v) in networks.items()}) if sparse else {})))
            while True:
                line = await process.stdout.readline()
                if not line: raise RuntimeError(f'Simulator exited: {process.returncode}')
                stats['bytes'] += len(line)
                start = time.perf_counter(); message = load_json(line); stats['parse_seconds'] += time.perf_counter()-start
                if message['type'] == 'error': raise RuntimeError(message['error'])
                if message['type'] == 'result':
                    results[index] = message['result']
                    results[index]['opponent'] = rival or 'self'
                    results[index]['curriculumKind'] = config.get('curriculumKind', 'full')
                    results[index]['learnerSeats'] = [seat for seat, policy in enumerate(policies) if policy == 'model']
                    if trajectory: results[index]['trajectory'] = moves
                    break
                start = time.perf_counter()
                if message['observation'].get('wire') == 'sparse-delta-v1' and 'prefix' not in message['observation']:
                    stats['reused_prefixes'] += 1
                if message['observation'].get('wire') == 'tensor-v1':
                    size = message.get('binaryBytes')
                    if type(size) is not int or not 0 < size <= 32 * 1024 * 1024:
                        raise ValueError('Invalid tensor payload size')
                    body = await process.stdout.readexactly(size)
                    stats['bytes'] += len(body)
                    key = message.get('modelKey', 'current')
                    message['observation'] = decode_tensor(message['observation'], body, networks[key][1])
                else:
                    message['observation'] = decoder.decode(message['observation'],
                        (message.get('modelKey', 'current'), message['seat']))
                stats['decode_seconds'] += time.perf_counter()-start
                future = asyncio.get_running_loop().create_future()
                await pending.put((message['observation'], future, message.get('modelKey','current')))
                selection = await future
                if trajectory and message.get('modelKey','current') == 'current':
                    moves.append(dict(observation=message['observation'], seat=message['seat'],
                                      learning=message.get('learning'), **selection))
                    choice = selection['choice']
                else: choice = selection
                await send(process, dict(type='select', id=message['id'], index=choice))

    def predict(key, observations):
        active_model, active_vocab = networks[key]
        batch_start = start = time.perf_counter()
        batch = collate(observations, active_vocab, device)
        stats['collate_seconds'] += time.perf_counter()-start
        start = time.perf_counter()
        with torch.inference_mode():
            if trajectory and key == 'current':
                logits, values = active_model(batch)
                distribution = torch.distributions.Categorical(logits=logits)
                selected = distribution.sample()
                log_probs = distribution.log_prob(selected)
                # Transfer one result matrix after all GPU work is queued.
                # Float64 preserves both integer choices and float32 values.
                outputs = torch.stack((selected.to(torch.float64), log_probs, values), dim=1).cpu().tolist()
                choices = [dict(choice=int(choice), old_log_prob=logp, old_value=value)
                           for choice, logp, value in outputs]
            elif trajectory and opponent_temperature > 0:
                choices = torch.distributions.Categorical(
                    logits=active_model.policy_logits(batch)/opponent_temperature).sample().tolist()
            elif not trajectory and evaluation_temperature > 0:
                choices = torch.distributions.Categorical(
                    logits=active_model.policy_logits(batch)/evaluation_temperature).sample().tolist()
            else: choices = active_model.policy_logits(batch).argmax(-1).tolist()
        stats['infer_seconds'] += time.perf_counter()-start
        stats['collate_infer_seconds'] += time.perf_counter()-batch_start
        stats['batches'] += 1; stats['decisions'] += len(observations)
        stats['candidates'] += sum(o['action_count'] if o.get('wire') == 'tensor-v1' else len(o['candidates']) for o in observations)
        stats['max_batch'] = max(stats['max_batch'], len(observations))
        stats['model_decisions'][key] = stats['model_decisions'].get(key, 0) + len(observations)
        return choices

    async def infer():
        while True:
            items = [await pending.get()]
            if batch_wait_ms: await asyncio.sleep(batch_wait_ms / 1000)
            while not pending.empty(): items.append(pending.get_nowait())
            grouped = {}
            for item in items: grouped.setdefault(item[2], []).append(item)
            for key, items in grouped.items():
                observations = [item[0] for item in items]
                # Keep the event loop receiving simulator messages during GPU work.
                prediction = asyncio.create_task(asyncio.to_thread(predict, key, observations))
                try:
                    choices = await asyncio.shield(prediction)
                except asyncio.CancelledError:
                    # Finish the in-flight read before the caller can reuse the model.
                    await prediction
                    raise
                for (_, future, _), choice in zip(items, choices): future.set_result(choice)
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
    stats['fresh_engine_requests'] = sum(result['engineRequests'] - result['replayedEngineRequests'] for result in results)
    stats['engine_requests_per_second'] = stats['fresh_engine_requests']/stats['seconds']
    stats['mean_batch'] = stats['decisions']/max(1, stats['batches'])
    stats['forced_choices'] = sum(sum(result.get('forcedChoices', {}).values()) for result in results)
    return dict(results=results, stats=stats)


if __name__ == '__main__':
    import argparse
    from model import EntityPolicy
    parser = argparse.ArgumentParser()
    parser.add_argument('checkpoint')
    parser.add_argument('--games', type=int, default=12)
    parser.add_argument('--workers', type=int, default=16)
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
