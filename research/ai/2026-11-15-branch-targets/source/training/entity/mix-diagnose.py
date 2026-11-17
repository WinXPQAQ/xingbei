"""Plain-game comparison of sage continuation policies (no search).

Variants, all on the same training-range seeds and lineups (never evaluation seeds):
  base             current network
  gem              current network, gem specialist answers while holding gems
  base+refine      base, first refine forced
  gem+refine       gem specialist routing, first refine forced
Paired by game; reports wins, refines, codex usage and spell damage.
"""
import argparse
import collections
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
    parser.add_argument('checkpoint', type=Path)
    parser.add_argument('--gem-model', type=Path, required=True)
    parser.add_argument('--frozen-current', type=Path, required=True)
    parser.add_argument('--frozen-417', type=Path, required=True)
    parser.add_argument('--games', type=int, default=576)
    parser.add_argument('--offset', type=int, default=4000000)
    parser.add_argument('--workers', type=int, default=18)
    parser.add_argument('--device', default='cuda')
    parser.add_argument('--revision', default='branch-targets-20261114')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    torch.set_num_threads(2)
    model, vocabulary = load(args.checkpoint)
    models = {'frozenCurrent': load(args.frozen_current), 'anchor417': load(args.frozen_417), 'gem': load(args.gem_model)}
    base = configurations('sage', args.games, args.offset, args.revision)
    for config in base:
        config['profile'] = False
    variants = {'base': {}, 'gem': dict(gemPolicy='gem'), 'base+refine': dict(sageRefineFirst=True),
                'gem+refine': dict(gemPolicy='gem', sageRefineFirst=True)}
    results, report = {}, {}
    for name, extra in variants.items():
        configs = [dict(c, **extra) for c in base]
        results[name] = runtime.run(model, vocabulary, configs, workers=args.workers, device=args.device,
                                    models=models, binary=True)['results']
        for result, config in zip(results[name], configs):
            result['learnerSeats'] = [config['focusSeat']]
        s = summarize(results[name], base)
        report[name] = dict(wins=s['wins'], completed=s['completed'], win_rate=s['win_rate'],
                            refine=s['root_actions'].get('refine', 0), arcane=s['skill_notes'].get('arcaneCodex', 0),
                            holy=s['skill_notes'].get('holyCodex', 0), wisdom=s['skill_notes'].get('wisdomCodex', 0),
                            rebound=s['skill_notes'].get('spellRebound', 0), spell=s['behavior'].get('enemySpellDamage'),
                            attack=s['behavior'].get('enemyAttackDamage'))
        print(name, json.dumps(report[name]), flush=True)
    win = lambda r, c: int(bool(r.get('rewards')) and r['rewards'][str(c['focusSeat'])] == 1)
    rng = random.Random(1)
    for a, b in [('gem', 'base'), ('base+refine', 'base'), ('gem+refine', 'base'), ('gem+refine', 'base+refine')]:
        diffs = [win(x, c) - win(y, c) for x, y, c in zip(results[a], results[b], base)]
        mean = sum(diffs) / len(diffs)
        boot = sorted(sum(rng.choices(diffs, k=len(diffs))) / len(diffs) for _ in range(2000))
        report[f'{a} - {b}'] = dict(difference=mean, interval95=[boot[49], boot[1949]])
        print(f'{a} - {b}', round(mean, 3), [round(boot[49], 3), round(boot[1949], 3)], flush=True)
    args.output.write_text(json.dumps(report, indent=2))


if __name__ == '__main__':
    with GameRuntime() as runtime:
        main(runtime)
