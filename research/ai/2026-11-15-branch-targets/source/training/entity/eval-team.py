"""Team-mode evaluation of several checkpoints on one seed set (standard rules).

The focal hero's team (three seats) is played by each candidate; opponents and
lineups follow specialists.configurations(team=True). Paired against the
frozen-current team on the same seeds. Seed range should be unused for selection.
"""
import argparse
import json
from pathlib import Path

import torch

from model import EntityPolicy
from pool import GameRuntime
from specialists import configurations, summarize, paired_difference


def load(path):
    return EntityPolicy.restore(torch.load(path, map_location='cpu', weights_only=False))


def main(runtime):
    parser = argparse.ArgumentParser()
    parser.add_argument('--candidates', nargs='+', required=True, help='label=path')
    parser.add_argument('--frozen-current', type=Path, required=True)
    parser.add_argument('--frozen-417', type=Path, required=True)
    parser.add_argument('--games', type=int, default=576)
    parser.add_argument('--eval-seed', type=int, default=960000000)
    parser.add_argument('--workers', type=int, default=18)
    parser.add_argument('--device', default='cuda')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    torch.set_num_threads(2)
    frozen = load(args.frozen_current)
    models = {'frozenCurrent': frozen, 'anchor417': load(args.frozen_417)}
    configs = configurations('sage', args.games, 0, 'branch-targets-20261114', evaluation=True,
                             eval_seed=args.eval_seed, team=True)
    for c in configs: c['profile'] = False
    run = lambda m, v: runtime.run(m, v, configs, workers=args.workers, device=args.device, models=models, binary=True)['results']
    control = run(*frozen)
    report = dict(control=summarize(control, configs), candidates={})
    print('control', report['control']['wins'], flush=True)
    for item in args.candidates:
        label, path = item.split('=', 1)
        results = run(*load(path))
        s = summarize(results, configs)
        report['candidates'][label] = dict(path=path, summary=s, paired=paired_difference(results, control, configs))
        p = report['candidates'][label]['paired']
        print(label, s['wins'], '/', s['completed'], round(p['difference'], 3), [round(x, 3) for x in p['seed_cluster_interval95']],
              'routes', s['victory_routes'], 'arc', s['skill_notes'].get('arcaneCodex', 0), flush=True)
    args.output.write_text(json.dumps(report, indent=1))


if __name__ == '__main__':
    with GameRuntime() as runtime:
        main(runtime)
