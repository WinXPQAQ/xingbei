"""Score human turn choices with rollouts from recorded positions.

For each human turn-start position (human-positions.mjs), every first-action
category the engine allows (refine / purchase / synthesize / attack / spell /
heroSkill) is played to the end K times. Hidden information the human could not
see is resampled (other hands, deck order, later randomness). The human seat
continues with the given network; all other seats use --others (by default the
migrated 417 network, which played against the human in these records).

Output per position: mean outcome per category, the category the human chose,
the category the network would choose, and a paired comparison of the two.
"""
import argparse
import collections
import json
from pathlib import Path
import time

import torch

from model import EntityPolicy
from pool import GameRuntime
from branching import paired, critical

ACTIONS = ('refine', 'purchase', 'synthesize', 'attack', 'spell', 'heroSkill')


def load(path):
    return EntityPolicy.restore(torch.load(path, map_location='cpu', weights_only=False))


def main(runtime):
    parser = argparse.ArgumentParser()
    parser.add_argument('positions', type=Path)
    parser.add_argument('checkpoint', type=Path)
    parser.add_argument('--frozen-current', type=Path, required=True)
    parser.add_argument('--frozen-417', type=Path, required=True)
    parser.add_argument('--others', default='model:anchor417')
    parser.add_argument('--hero', default=None)
    parser.add_argument('--samples', type=int, default=16)
    parser.add_argument('--z', type=float, default=2.)
    parser.add_argument('--workers', type=int, default=18)
    parser.add_argument('--device', default='cuda')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    torch.set_num_threads(2)
    model, vocabulary = load(args.checkpoint)
    models = {'frozenCurrent': load(args.frozen_current), 'anchor417': load(args.frozen_417)}
    rows = [json.loads(line) for line in args.positions.read_text().splitlines() if line.strip()]
    if args.hero: rows = [r for r in rows if r['hero'] == args.hero]
    run = lambda jobs: runtime.run(model, vocabulary, jobs, workers=args.workers, device=args.device, models=models, binary=True)

    def base(row):
        policies = [args.others] * 6
        policies[row['seat']] = 'model'
        return dict(seed=row['config']['seed'] % (2 ** 31), heroIds=row['config']['heroIds'], startState=row['state'],
                    startConfig=row['config'], revision='human-snapshot', ruleVariant='standard',
                    decisionMode='hierarchical-v1', profile=False, capture=False, seatPolicies=policies,
                    focusSeat=row['seat'], opponent=args.others)

    def probe(row, forced):
        return dict(base(row), forced=forced, returnChoices=True,
                    branch=dict(seat=row['seat'], focalTurn=1, expand=True))

    started = time.time()
    # Level 1: root direction node. Level 2: the ordinary-action node after 'activate'.
    level1 = run([probe(r, []) for r in rows])['results']
    trees = []
    second = []
    for i, (row, result) in enumerate(zip(rows, level1)):
        info = result.get('branchInfo') or {}
        if info.get('status') != 'node' or info.get('stage') != 'direction':
            trees.append(None); continue
        labels, greedy = info['labels'], result['recorded'][0]['choice']
        prefix = result['choices']
        entry = lambda label: dict(playerId=row['seat'], type='action', stage='direction', index=labels.index(label))
        tree = dict(labels=labels, greedy=labels[greedy], paths={})
        for label in dict.fromkeys(labels):
            if label in ACTIONS: tree['paths'][label] = prefix + [entry(label)]
            elif label == 'activate': second.append((i, prefix + [entry(label)]))
        trees.append(tree)
    if second:
        level2 = run([probe(rows[i], forced) for i, forced in second])['results']
        for (i, forced), result in zip(second, level2):
            info = result.get('branchInfo') or {}
            if info.get('status') != 'node' or info.get('stage') != 'direction':
                # Only one ordinary action after activation: 'activate' is itself a leaf.
                trees[i]['paths']['activate'] = forced
                trees[i]['single_after_activate'] = True
            else:
                labels = info['labels']
                prefix = result['choices']
                if trees[i]['greedy'] == 'activate':
                    trees[i]['greedy'] = labels[result['recorded'][0]['choice']]
                for label in dict.fromkeys(labels):
                    if label in ACTIONS and label not in trees[i]['paths']:
                        trees[i]['paths'][label] = prefix + [dict(playerId=rows[i]['seat'], type='action', stage='direction',
                                                                   index=labels.index(label))]
    jobs, owners = [], []
    for i, tree in enumerate(trees):
        if not tree: continue
        for label, forced in tree['paths'].items():
            for k in range(args.samples):
                jobs.append(dict(base(rows[i]), forced=forced,
                                 resample=dict(seat=rows[i]['seat'], seed=(i * 7919 + k * 104729 + 17) % (2 ** 31))))
                owners.append((i, label, k))
    output = run(jobs)['results'] if jobs else []
    values = collections.defaultdict(dict)
    invalid = collections.Counter()
    for (i, label, k), result, job in zip(owners, output, jobs):
        if result.get('failed') or result.get('forcedUsed', 0) != len(job['forced']) or not result.get('terminated'):
            invalid['rollout'] += 1; continue
        values[(i, label)][k] = float(result['rewards'][str(rows[i]['seat'])])
    report, verdicts = [], collections.Counter()
    for i, (row, tree) in enumerate(zip(rows, trees)):
        if not tree:
            verdicts['noRoot'] += 1; continue
        means = {l: sum(v.values()) / len(v) for l in tree['paths'] if (v := values[(i, l)])}
        human, ai = row['human'], tree['greedy']
        if tree.get('single_after_activate') and human in ('attack', 'spell', 'heroSkill') and human not in means:
            human = 'activate'
        entry = dict(gameId=row['gameId'], sequence=row['sequence'], hero=row['hero'], human=human, ai=ai,
                     means={l: round(m, 3) for l, m in means.items()},
                     best=max(means, key=means.get) if means else None)
        if human in means and ai in means and human != ai:
            shared = sorted(set(values[(i, human)]) & set(values[(i, ai)]))
            difference, error = paired([values[(i, human)][k] for k in shared], [values[(i, ai)][k] for k in shared])
            threshold = critical(args.z, len(shared)) * error
            entry.update(difference=round(difference, 3), threshold=round(threshold, 3))
            verdict = 'humanBetter' if difference > threshold else 'aiBetter' if -difference > threshold else 'unclear'
        elif human == ai:
            verdict = 'same'
        else:
            verdict = 'humanChoiceUnavailable' if human not in means else 'aiChoiceUnavailable'
        entry['verdict'] = verdict; verdicts[verdict] += 1
        report.append(entry)
    by_human = collections.defaultdict(collections.Counter)
    for e in report: by_human[e['human']][e['verdict']] += 1
    summary = dict(positions=len(rows), verdicts=dict(verdicts), by_human_action={k: dict(v) for k, v in by_human.items()},
                   rollouts=len(jobs), invalid=dict(invalid), seconds=round(time.time() - started), samples=args.samples)
    args.output.write_text(json.dumps(dict(summary=summary, positions=report), ensure_ascii=False, indent=1))
    print(json.dumps(summary, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    with GameRuntime() as runtime:
        main(runtime)
