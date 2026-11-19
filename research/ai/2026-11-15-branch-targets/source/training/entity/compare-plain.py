"""Compare single networks on plain games (no search), paired by seed.

usage: python compare-plain.py --models a.pt b.pt ... --labels a b ... [--refine-first]
Opponents and lineups follow specialists.configurations('sage', ...); training-range seeds only.
"""
import argparse
import json
from pathlib import Path
import random

import torch

from model import EntityPolicy
from pool import GameRuntime
from specialists import configurations, summarize


def load(path):
    return EntityPolicy.restore(torch.load(path, map_location='cpu', weights_only=False))


def main(runtime):
    parser = argparse.ArgumentParser()
    parser.add_argument('--models', type=Path, nargs='+', required=True)
    parser.add_argument('--labels', nargs='+', required=True)
    parser.add_argument('--frozen-current', type=Path, required=True)
    parser.add_argument('--frozen-417', type=Path, required=True)
    parser.add_argument('--games', type=int, default=1152)
    parser.add_argument('--offset', type=int, default=6000000)
    parser.add_argument('--workers', type=int, default=18)
    parser.add_argument('--device', default='cuda')
    parser.add_argument('--revision', default='branch-targets-20261114')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    torch.set_num_threads(2)
    models = {'frozenCurrent': load(args.frozen_current), 'anchor417': load(args.frozen_417)}
    base = configurations('sage', args.games, args.offset, args.revision)
    for config in base: config['profile'] = False
    results, report = {}, {}
    for path, label in zip(args.models, args.labels):
        model, vocabulary = load(path)
        results[label] = runtime.run(model, vocabulary, base, workers=args.workers, device=args.device,
                                     models=models, binary=True)['results']
        for result, config in zip(results[label], base): result['learnerSeats'] = [config['focusSeat']]
        s = summarize(results[label], base)
        report[label] = dict(wins=s['wins'], completed=s['completed'], win_rate=s['win_rate'],
            refine=s['root_actions'].get('refine', 0), arcane=s['skill_notes'].get('arcaneCodex', 0),
            holy=s['skill_notes'].get('holyCodex', 0), wisdom=s['skill_notes'].get('wisdomCodex', 0),
            spell=s['behavior'].get('enemySpellDamage'), attack=s['behavior'].get('enemyAttackDamage'),
            routes=s['victory_routes'])
        print(label, json.dumps(report[label]), flush=True)
    win = lambda r, c: int(bool(r.get('rewards')) and r['rewards'][str(c['focusSeat'])] == 1)
    rng = random.Random(1)
    first = args.labels[0]
    for label in args.labels[1:]:
        diffs = [win(x, c) - win(y, c) for x, y, c in zip(results[label], results[first], base)]
        mean = sum(diffs) / len(diffs)
        boot = sorted(sum(rng.choices(diffs, k=len(diffs))) / len(diffs) for _ in range(2000))
        report[f'{label} - {first}'] = dict(difference=mean, interval95=[boot[49], boot[1949]])
        print(f'{label} - {first}', round(mean, 3), [round(boot[49], 3), round(boot[1949], 3)], flush=True)
    args.output.write_text(json.dumps(report, indent=2))


if __name__ == '__main__':
    with GameRuntime() as runtime:
        main(runtime)
