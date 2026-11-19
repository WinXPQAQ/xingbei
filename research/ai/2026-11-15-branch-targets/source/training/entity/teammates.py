"""Do the sage's teammates conflict with a refine/morale plan?

Same seeds, sage = merged network, with and without a forced first refine.
Reports per-team root actions of the sage's two teammates and team outcomes.
"""
import argparse
import collections
import json
from pathlib import Path

import torch

from model import EntityPolicy
from pool import GameRuntime
from specialists import configurations


def load(path):
    return EntityPolicy.restore(torch.load(path, map_location='cpu', weights_only=False))


def main(runtime):
    parser = argparse.ArgumentParser()
    parser.add_argument('checkpoint', type=Path)
    parser.add_argument('--frozen-current', type=Path, required=True)
    parser.add_argument('--frozen-417', type=Path, required=True)
    parser.add_argument('--games', type=int, default=288)
    parser.add_argument('--offset', type=int, default=7000000)
    parser.add_argument('--workers', type=int, default=12)
    parser.add_argument('--device', default='cpu')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    torch.set_num_threads(2)
    model, vocabulary = load(args.checkpoint)
    models = {'frozenCurrent': load(args.frozen_current), 'anchor417': load(args.frozen_417)}
    base = configurations('sage', args.games, args.offset, 'branch-targets-20261114')
    report = {}
    for name, extra in [('no-forced-refine', {}), ('forced-refine', dict(sageRefineFirst=True))]:
        configs = [dict(c, profile=False, **extra) for c in base]
        results = runtime.run(model, vocabulary, configs, workers=args.workers, device=args.device,
                              models=models, binary=True)['results']
        totals = collections.Counter(); by_rival = collections.defaultdict(collections.Counter)
        for result, config in zip(results, configs):
            seat = config['focusSeat']
            team = result['publicBehavior']['seats'][str(seat)]
            other = 'blue' if team == 'red' else 'red'
            mates = [s for s, t in result['publicBehavior']['seats'].items() if t == team and int(s) != seat]
            rival = by_rival[config['opponent']]
            for counter in (totals, rival):
                counter['games'] += 1
                counter['win'] += int(bool(result.get('rewards')) and result['rewards'][str(seat)] == 1)
                for mate in mates:
                    actions = result['heroBehavior'][mate]['rootActions']
                    for key in ('synthesize', 'purchase', 'refine', 'activate', 'play'):
                        counter['mate_' + key] += actions.get(key, 0)
                sage = result['heroBehavior'][str(seat)]
                counter['sage_refine'] += sage['rootActions'].get('refine', 0)
                counter['sage_synthesize'] += sage['rootActions'].get('synthesize', 0)
                T = result['publicBehavior']['teams']
                counter['own_cups'] += T[team]['end']['cups']; counter['enemy_cups'] += T[other]['end']['cups']
                counter['own_morale_lost'] += T[team]['start']['morale'] - T[team]['end']['morale']
                counter['enemy_morale_lost'] += T[other]['start']['morale'] - T[other]['end']['morale']
                won_by_cups = result.get('winner') == team and T[team]['end']['cups'] >= 5
                counter['win_by_cups'] += int(won_by_cups)
                counter['win_by_morale'] += int(result.get('winner') == team and not won_by_cups)
        mean = lambda c: {k: round(v / c['games'], 3) for k, v in c.items() if k != 'games'} | {'games': c['games']}
        report[name] = dict(all=mean(totals), by_rival={k: mean(v) for k, v in by_rival.items()})
        print(name, json.dumps(report[name]['all'], ensure_ascii=False), flush=True)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    with GameRuntime() as runtime:
        main(runtime)
