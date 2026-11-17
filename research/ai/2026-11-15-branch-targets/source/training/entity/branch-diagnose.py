"""Measure how much one-turn counterfactual improvement the current policy leaves.

Plays greedy specialist games (same lineups/opponents as specialists.py), samples
one position before a focal turn per game, expands the turn's strategic choices
and reports per-label outcomes plus how often the greedy choice was beaten.
"""
import argparse
import json
from pathlib import Path
import random
import time

import torch

from model import EntityPolicy
from pool import GameRuntime
from specialists import configurations
from branching import select_boundaries, expand_trees, build_targets


def load(path):
    return EntityPolicy.restore(torch.load(path, map_location='cpu', weights_only=False))


def main(runtime):
    parser = argparse.ArgumentParser()
    parser.add_argument('checkpoint', type=Path)
    parser.add_argument('--hero', default='sage')
    parser.add_argument('--frozen-current', type=Path, required=True)
    parser.add_argument('--frozen-417', type=Path, required=True)
    parser.add_argument('--games', type=int, default=48)
    parser.add_argument('--offset', type=int, default=900000)
    parser.add_argument('--workers', type=int, default=12)
    parser.add_argument('--device', default='cpu')
    parser.add_argument('--depth', type=int, default=6)
    parser.add_argument('--leaves', type=int, default=8)
    parser.add_argument('--temperature', type=float, default=.5)
    parser.add_argument('--samples', type=int, default=8)
    parser.add_argument('--train', type=int, default=0, help='Seeds used for targets; the rest are a holdout')
    parser.add_argument('--z', type=float, default=2.)
    parser.add_argument('--revision', default='branch-targets-20261114')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--explore', action='store_true', help='Refine first, then sample only gem-holding focal turns')
    args = parser.parse_args()
    torch.set_num_threads(2)
    model, vocabulary = load(args.checkpoint)
    models = {'frozenCurrent': load(args.frozen_current), 'anchor417': load(args.frozen_417)}
    configs = configurations(args.hero, args.games, args.offset, args.revision, capture_focal=True)
    for config in configs:
        config['profile'] = False
        if args.explore: config['sageRefineFirst'] = True
    started = time.time()
    games = runtime.run(model, vocabulary, configs, workers=args.workers, device=args.device, models=models, binary=True)
    played = time.time() - started
    picks = select_boundaries(games['results'], configs, args.games, random.Random(args.offset), require_gem=args.explore)
    started = time.time()
    nodes, leaves, stats = expand_trees(runtime, model, vocabulary, picks, workers=args.workers, device=args.device,
                                        models=models, max_depth=args.depth, max_leaves=args.leaves, samples=args.samples)
    branched = time.time() - started
    examples, report = build_targets(picks, nodes, leaves, temperature=args.temperature, hero=args.hero, round_number=0,
                                     z=args.z, train=args.train or None, honest=True)
    if args.train:
        _, old = build_targets(picks, nodes, leaves, temperature=args.temperature, hero=args.hero, round_number=0,
                               z=args.z, train=args.train, honest=False)
        report['holdout_same_sample_test'] = old['holdout']
        report['same_sample_significant_changes'] = old['significant_changes']
    wins = sum(int(r['rewards'][str(c['focusSeat'])] == 1) for r, c in zip(games['results'], configs) if r.get('terminated'))
    report.update(stats=stats, examples=len(examples), checkpoint=str(args.checkpoint), hero=args.hero,
                  games=len(configs), greedy_wins=wins, play_seconds=played, branch_seconds=branched,
                  game_seconds_per_game=played / len(configs))
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({k: v for k, v in report.items() if k != 'labels'}, ensure_ascii=False, indent=2))
    for label, entry in report['labels'].items():
        print(f"{label:40s} n={entry['available']:4d} Q={entry['q_mean']:+.3f} best={entry['best']:4d} "
              f"greedy={entry['greedy']:4d} target={entry['target_mean']:.3f}")


if __name__ == '__main__':
    with GameRuntime() as runtime:
        main(runtime)
