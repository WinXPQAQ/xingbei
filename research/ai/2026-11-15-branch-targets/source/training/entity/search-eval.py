"""Decision-time search for the focal hero (sage) in evaluation games.

Every focal strategic decision (action direction, hero skill, cost size,
targets) is chosen by rollouts: for each distinct label, K continuations from
the exact game state, after resampling everything the focal player cannot see
(other hands, deck order, later randomness). Continuations use the given greedy
policy for all model seats; the other five seats keep their configured
controllers. Siblings share the K resampling seeds (common random numbers).

The real game is reconstructed each step from its seed and full choice list.
"""
import argparse
import collections
import json
from pathlib import Path
import time

import torch

from model import EntityPolicy
from pool import GameRuntime
from specialists import configurations, summarize
from branching import paired, critical


def load(path):
    return EntityPolicy.restore(torch.load(path, map_location='cpu', weights_only=False))


def strip(config):
    return {k: v for k, v in config.items() if k not in ('captureSeat', 'capture', 'profile', 'sageRefineFirst')}


def entry(seat, stage, labels, label, greedy):
    index = greedy if labels[greedy] == label else labels.index(label)
    return dict(playerId=seat, type='action', stage=stage, index=index)


def main(runtime):
    parser = argparse.ArgumentParser()
    parser.add_argument('checkpoint', type=Path)
    parser.add_argument('--frozen-current', type=Path, required=True)
    parser.add_argument('--frozen-417', type=Path, required=True)
    parser.add_argument('--hero', default='sage')
    parser.add_argument('--first', type=int, default=0, help='First evaluation game index')
    parser.add_argument('--games', type=int, default=72)
    parser.add_argument('--eval-games', type=int, default=144, help='Size of the evaluation set the slice comes from')
    parser.add_argument('--eval-seed', type=int, default=920000000)
    parser.add_argument('--samples', type=int, default=8)
    parser.add_argument('--margin', type=float, default=.1)
    parser.add_argument('--z', type=float, default=2., help='Change only if the paired difference exceeds this many standard errors (t-corrected); 0 disables')
    parser.add_argument('--workers', type=int, default=18)
    parser.add_argument('--device', default='cuda')
    parser.add_argument('--revision', default='branch-targets-20261114')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--belief', type=Path, help='Hand belief model; unknown hand cards are drawn from it instead of uniformly')
    parser.add_argument('--skip-baselines', action='store_true')
    parser.add_argument('--gem-model', type=Path, help='Answer the sage seat with this network while it holds a gem (real game and rollouts)')
    args = parser.parse_args()
    torch.set_num_threads(2)
    model, vocabulary = load(args.checkpoint)
    models = {'frozenCurrent': load(args.frozen_current), 'anchor417': load(args.frozen_417)}
    if args.gem_model: models['gem'] = load(args.gem_model)
    every = configurations(args.hero, args.eval_games, 0, args.revision, evaluation=True, eval_seed=args.eval_seed)
    configs = [strip(c) for c in every[args.first:args.first + args.games]]
    if args.gem_model:
        for c in configs: c['gemPolicy'] = 'gem'
    run = lambda jobs: runtime.run(model, vocabulary, jobs, workers=args.workers, device=args.device, models=models, binary=True)
    belief = None
    if args.belief:
        from belief import restore, weights_for
        belief, symbols = restore(args.belief, args.device)
        if symbols != vocabulary.symbols: raise ValueError('Belief model vocabulary differs from the policy')

    started = time.time()
    control_configs = [dict(c, profile=False, seatPolicies=[('model:frozenCurrent' if i == c['focusSeat'] else p)
                       for i, p in enumerate(c['seatPolicies'])]) for c in configs]
    if args.skip_baselines:
        plain, control = [], []
    else:
        plain = run([dict(c, profile=False) for c in configs])['results']
        control = run(control_configs)['results']
    baseline_seconds = time.time() - started

    games = [dict(config=c, forced=[], node=None, done=False, result=None, decisions=[], nodes=0) for c in configs]
    stats = collections.Counter()
    started = time.time()
    while not all(g['done'] for g in games):
        active = [g for g in games if not g['done']]
        jobs = [dict(g['config'], profile=False, forced=g['forced'], returnChoices=True, trackPublicHands=True,
                     branch=dict(seat=g['config']['focusSeat'], focalTurn=None, expand=True)) for g in active]
        for g, result in zip(active, run(jobs)['results']):
            info = result.get('branchInfo') or {}
            if result.get('forcedUsed', 0) != len(g['forced']):
                raise RuntimeError('Real game failed to replay its own choices')
            if info.get('status') == 'node':
                recorded = result['recorded'][0]
                g['node'] = dict(labels=info['labels'], stage=info['stage'], turn=info['turn'],
                                 greedy=recorded['choice'], prefix=result['choices'], observation=recorded['observation'])
            elif info.get('status') == 'complete' and result.get('terminated'):
                g['done'] = True; g['result'] = result
            else:
                g['done'] = True; g['result'] = result; stats['abnormal'] += 1
        pending = [g for g in games if not g['done'] and g['node']]
        jobs, owners = [], []
        node_weights = [None] * len(pending)
        if belief is not None and pending:
            node_weights = weights_for(belief, [g['node']['observation'] for g in pending], vocabulary,
                                       [g['config']['focusSeat'] for g in pending], args.device)
        for gi, g in enumerate(pending):
            node, seat = g['node'], g['config']['focusSeat']
            unique = list(dict.fromkeys(node['labels']))
            g['nodes'] += 1
            for label in unique:
                forced = node['prefix'] + [entry(seat, node['stage'], node['labels'], label, node['greedy'])]
                for k in range(args.samples):
                    seed = (g['config']['seed'] * 1000003 + g['nodes'] * 97 + k) % (2 ** 31)
                    resample = dict(seat=seat, seed=seed)
                    if node_weights[gi] is not None:
                        resample['weights'] = {str(pid): w for pid, w in node_weights[gi].items()}
                    jobs.append(dict(g['config'], profile=False, forced=forced, resample=resample))
                    owners.append((gi, label, k))
        if jobs:
            output = run(jobs)
            stats['rollouts'] += len(jobs)
            values = collections.defaultdict(dict)
            for (gi, label, k), result, job in zip(owners, output['results'], jobs):
                if result.get('failed'):
                    stats['rollout_rule_errors'] += 1; continue
                if result.get('forcedUsed', 0) != len(job['forced']) or not result.get('terminated'):
                    stats['rollout_invalid'] += 1; continue
                values[(gi, label)][k] = float(result['rewards'][str(job['resample']['seat'])])
            for gi, g in enumerate(pending):
                node = g['node']
                unique = list(dict.fromkeys(node['labels']))
                means = {l: sum(values[(gi, l)].values()) / len(values[(gi, l)]) for l in unique if values[(gi, l)]}
                greedy_label = node['labels'][node['greedy']]
                best = max(means, key=means.get) if means else greedy_label
                chosen = greedy_label
                if best != greedy_label and greedy_label in means and means[best] - means[greedy_label] > args.margin:
                    shared = sorted(set(values[(gi, best)]) & set(values[(gi, greedy_label)]))
                    if args.z <= 0:
                        chosen = best
                    elif len(shared) >= 4:
                        difference, error = paired([values[(gi, best)][k] for k in shared], [values[(gi, greedy_label)][k] for k in shared])
                        if difference > max(critical(args.z, len(shared)) * error, args.margin): chosen = best
                elif greedy_label not in means and means:
                    chosen = best
                stats['changed'] += int(chosen != greedy_label); stats['decisions'] += 1
                g['decisions'].append(dict(turn=node['turn'], stage=node['stage'], greedy=greedy_label, chosen=chosen,
                                           means={l: round(v, 3) for l, v in means.items()}))
                g['forced'] = node['prefix'] + [entry(g['config']['focusSeat'], node['stage'], node['labels'], chosen, node['greedy'])]
                g['node'] = None
        print(json.dumps(dict(time=round(time.time() - started), done=sum(g['done'] for g in games), **stats)), flush=True)

    searched = [g['result'] for g in games]
    for result, c in zip(searched + plain, configs + configs):
        result['learnerSeats'] = [c['focusSeat']]
    for result, c in zip(control, configs):
        result['learnerSeats'] = [c['focusSeat']]
    changes = collections.Counter((d['stage'], d['greedy'], d['chosen']) for g in games for d in g['decisions'] if d['greedy'] != d['chosen'])
    report = dict(checkpoint=str(args.checkpoint), first=args.first, games=args.games, samples=args.samples, margin=args.margin,
                  search=summarize(searched, configs), plain=summarize(plain, configs), control=summarize(control, configs),
                  stats=dict(stats), search_seconds=time.time() - started, baseline_seconds=baseline_seconds,
                  top_changes=[[list(k), v] for k, v in changes.most_common(30)],
                  per_game=[dict(seed=g['config']['seed'], seat=g['config']['focusSeat'],
                                 win=int(g['result']['rewards'][str(g['config']['focusSeat'])] == 1) if g['result'].get('rewards') else None,
                                 decisions=g['decisions'], public_hand_events=g['result']['publicHandEvents'], behavior=g['result'].get('heroBehavior', {}).get(str(g['config']['focusSeat'])),
                                 public=g['result'].get('publicBehavior'), winner=g['result'].get('winner'))
                            for g in games],
                  plain_results=[{k: v for k, v in r.items() if k not in ('choices', 'focalBoundaries')} for r in plain],
                  control_results=[{k: v for k, v in r.items() if k not in ('choices', 'focalBoundaries')} for r in control])
    args.output.write_text(json.dumps(report, ensure_ascii=False))
    for key in ('search', 'plain', 'control'):
        s = report[key]
        print(key, s['wins'], '/', s['completed'], 'refine', s['root_actions'].get('refine', 0),
              'arcane', s['skill_notes'].get('arcaneCodex', 0), 'holy', s['skill_notes'].get('holyCodex', 0),
              'wisdom', s['skill_notes'].get('wisdomCodex', 0), 'spell', s['behavior'].get('enemySpellDamage'))
    print('stats', dict(stats), 'seconds', round(report['search_seconds']))


if __name__ == '__main__':
    with GameRuntime() as runtime:
        main(runtime)
