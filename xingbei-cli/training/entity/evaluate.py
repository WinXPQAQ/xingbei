"""Paired, mirrored development evaluation; never a final untouched holdout."""
import argparse
import asyncio
import json
import random
from pathlib import Path
import torch
from model import EntityPolicy
from pool import run_games, ROSTERS


def summarize(results):
    # run_games assigns the model red on even indices, blue on odd indices.
    scores = [int(r['winner'] == ('red' if i % 2 == 0 else 'blue'))
              if r['terminated'] else None for i, r in enumerate(results)]
    complete = [s for s in scores if s is not None]
    pairs = [sum(scores[i:i+2])/2 for i in range(0, len(scores), 2)
             if None not in scores[i:i+2]]
    rng = random.Random(71029)
    bootstrap = sorted(sum(rng.choices(pairs, k=len(pairs)))/len(pairs) for _ in range(2000)) if pairs else []
    return dict(games=len(results), wins=sum(complete), completed=len(complete), truncated=len(results)-len(complete),
                win_rate=sum(complete)/len(complete) if complete else None,
                paired_seed_interval95=[bootstrap[49], bootstrap[1949]] if bootstrap else None)


async def evaluate(checkpoint, *, pairs=60, workers=4, device='cuda'):
    model, vocabulary = EntityPolicy.restore(torch.load(checkpoint, map_location='cpu', weights_only=False))
    reports = {}
    for opponent, count, rosters, base in [('v1.8.0-preview.1', pairs, ROSTERS, 411102000),
                                          ('v1.5', max(12, pairs//2), ROSTERS[:1], 511102000)]:
        configs = [dict(seed=base+p, heroIds=rosters[p % len(rosters)], start=p % 6)
                   for p in range(count) for _ in range(2)]
        rollout = await run_games(model, vocabulary, configs, workers=workers, device=device, opponent=opponent)
        reports[opponent] = {**summarize(rollout['results']), 'stats': rollout['stats'], 'results': rollout['results']}
    return dict(checkpoint=str(checkpoint), protocol='fixed development seeds; mirror team per seed; separate training seeds',
                opponents=reports)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('checkpoint'); parser.add_argument('output')
    parser.add_argument('--pairs', type=int, default=60); parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--device', default='cuda')
    args = parser.parse_args()
    if args.pairs < 1: parser.error('pairs must be positive')
    torch.set_num_threads(2)
    report = asyncio.run(evaluate(args.checkpoint, pairs=args.pairs, workers=args.workers, device=args.device))
    with open(args.output, 'x') as file: json.dump(report, file, indent=2)
    print(json.dumps({k: {n:v for n,v in r.items() if n not in ['stats','results']} for k,r in report['opponents'].items()}), flush=True)
