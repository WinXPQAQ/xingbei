"""Sage skill retention bank for team training.

States: sage-seat decisions from team-mode games played by the current team
model (so states follow the policy being trained). Non-action decisions only
(healing, responses, discards, card/skill/player choices): their candidate
structure is the same in both decision modes. Labels: the sage specialist's
distribution on the same observation. Used as --rehearsal-bank in
specialists.py; the KL term keeps these reactions while team play improves.

    python sage-retention.py OUT.pt --student team.pt --teacher merged.pt --frozen-current .. --frozen-417 ..
"""
import argparse
import collections
import json
from pathlib import Path
import random
import time

import torch

from model import EntityPolicy, collate_prepared, prepare_observation
from pool import GameRuntime
from specialists import configurations


def load(path):
    return EntityPolicy.restore(torch.load(path, map_location='cpu', weights_only=False))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    parser.add_argument('--student', type=Path, required=True)
    parser.add_argument('--teacher', type=Path, required=True)
    parser.add_argument('--frozen-current', type=Path, required=True)
    parser.add_argument('--frozen-417', type=Path, required=True)
    parser.add_argument('--games', type=int, default=1536)
    parser.add_argument('--offset', type=int, default=8000000)
    parser.add_argument('--decision-mode', default='hierarchical-v2')
    parser.add_argument('--max-per-type', type=int, default=6000)
    parser.add_argument('--workers', type=int, default=18)
    parser.add_argument('--device', default='cuda')
    args = parser.parse_args()
    torch.set_num_threads(4)
    student, vocabulary = load(args.student)
    teacher, teacher_vocabulary = load(args.teacher)
    if teacher_vocabulary.symbols != vocabulary.symbols:
        raise ValueError('Student and teacher vocabularies differ')
    models = {'frozenCurrent': load(args.frozen_current), 'anchor417': load(args.frozen_417)}
    configs = configurations('sage', args.games, args.offset, 'branch-targets-20261114', team=True,
                             decision_mode=args.decision_mode)
    for config in configs: config['profile'] = False
    states, started = collections.defaultdict(list), time.time()
    with GameRuntime() as runtime:
        for start in range(0, len(configs), 384):
            chunk = configs[start:start + 384]
            output = runtime.run(student, vocabulary, chunk, workers=args.workers, device=args.device,
                                 models=models, binary=False, collect_states=True)
            for config, result in zip(chunk, output['results']):
                seat = config['focusSeat']  # the sage
                for move in result.get('trajectory', []):
                    observation = move['observation']
                    kind = observation.get('decision_type')
                    if move['seat'] != seat or kind in (None, 'action'):
                        continue
                    states[kind].append(observation)
            print(json.dumps(dict(games=start + len(chunk), **{k: len(v) for k, v in states.items()},
                                  seconds=round(time.time() - started))), flush=True)
    rng = random.Random(1)
    rows = []
    teacher.to(args.device).eval()
    for kind, observations in states.items():
        rng.shuffle(observations)
        observations = observations[:args.max_per_type]
        prepared = [prepare_observation(o, vocabulary) for o in observations]
        with torch.no_grad():
            for begin in range(0, len(prepared), 256):
                logits = teacher.policy_logits(collate_prepared(prepared[begin:begin + 256], args.device))
                for observation, row in zip(observations[begin:begin + 256], logits):
                    probabilities = row[torch.isfinite(row)].softmax(-1)
                    if len(probabilities) < 2:
                        continue
                    rows.append(dict(observation=observation, probabilities=probabilities.cpu().tolist(), group=kind))
    counts = collections.Counter(row['group'] for row in rows)
    torch.save(dict(examples=rows, symbols=vocabulary.symbols, teacher=str(args.teacher), student=str(args.student),
                    decision_mode=args.decision_mode, counts=dict(counts)), args.output)
    print('saved', args.output, dict(counts))


if __name__ == '__main__':
    main()
