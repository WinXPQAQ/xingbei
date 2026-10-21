"""Measure correction margins on sampled training-range games, not a strength test."""
import argparse
import asyncio
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import torch
from model import policy_from_checkpoint, batch
from rollout import collect
from schedule import training_configs

async def run(args):
    torch.set_num_threads(2)
    saved = torch.load(args.checkpoint, map_location='cuda', weights_only=False)
    model = policy_from_checkpoint(saved, 'cuda')
    if not model.baseline_version:
        raise ValueError('Expected explicit residual policy')
    configs = training_configs(args.first_seed, 0, 48, 211, False)
    rows, games, _ = await collect(model, configs, 4, 'cuda')
    groups = defaultdict(list)
    with torch.inference_mode():
        for offset in range(0, len(rows), 128):
            selected = rows[offset:offset+128]
            logits, _ = model(*batch(selected, 'cuda'))
            for row, scores in zip(selected, logits.cpu()):
                n, base = len(row['actions']), row['baselineChoice']
                if n == 1:
                    continue
                scores = scores[:n]
                prior = math.log((n-1) * model.baseline_probability / (1-model.baseline_probability))
                correction = scores.clone(); correction[base] -= prior
                alternate = scores.clone(); alternate[base] = -torch.inf
                gap = float(scores[base] - alternate.max())
                groups[row['kind']].append({'candidates': n, 'prior': prior, 'remainingGap': gap,
                    'correctionAdvantage': prior-gap, 'baselineProbability': float(scores.softmax(-1)[base]),
                    'sampledDeparture': row['choice'] != base, 'greedyDeparture': int(scores.argmax()) != base})
    def summary(values):
        result = {'decisions': len(values)}
        for key in values[0]:
            nums = sorted(float(v[key]) for v in values)
            result[key] = {'mean': sum(nums)/len(nums), 'min': nums[0], 'max': nums[-1], 'median': nums[len(nums)//2]}
        return result
    report = {'checkpoint': str(args.checkpoint), 'sha256': hashlib.sha256(args.checkpoint.read_bytes()).hexdigest(),
              'firstSeed': args.first_seed, 'games': len(games), 'truncated': sum(g['truncated'] for g in games),
              'scope': 'Sampled training-range diagnostic; excludes forced single-candidate decisions, not win-rate evidence',
              'byDecision': {key: summary(values) for key, values in groups.items()}}
    with args.output.open('x') as stream:
        json.dump(report, stream, indent=2)
    print(json.dumps(report, indent=2))

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--checkpoint', type=Path, required=True)
    p.add_argument('--first-seed', type=int, required=True)
    p.add_argument('--output', type=Path, required=True)
    asyncio.run(run(p.parse_args()))
