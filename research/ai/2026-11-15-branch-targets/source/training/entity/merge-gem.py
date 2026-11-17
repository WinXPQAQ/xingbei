"""Merge two sage policies into one network.

While the sage holds a gem the target is the gem specialist's distribution;
otherwise the target is the base network's own distribution (anchor). States
come from full games played with that same routing (some with a forced first
refine for coverage), at every decision of the learner seat. No outcome enters
the loss; strength is measured separately.

    python merge-gem.py OUT.pt --base BASE.pt --gem GEM.pt --frozen-current .. --frozen-417 ..
"""
import argparse
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


def holds_gem(observation, gem_id):
    # sparse-v1: entity 0 is the observer's own player; its 'number:gem' feature
    # weight is log1p(gem) > 0 exactly when the observer holds a gem.
    if observation.get('wire') != 'sparse-v1':
        raise ValueError('Expected sparse-v1 observations')
    ids, weights = observation['entities'][0][0], observation['entities'][0][1]
    return any(i == gem_id and w > 0 for i, w in zip(ids, weights))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    parser.add_argument('--base', type=Path, required=True)
    parser.add_argument('--gem', type=Path, required=True)
    parser.add_argument('--frozen-current', type=Path, required=True)
    parser.add_argument('--frozen-417', type=Path, required=True)
    parser.add_argument('--games', type=int, default=1536)
    parser.add_argument('--offset', type=int, default=5000000)
    parser.add_argument('--steps', type=int, default=4000)
    parser.add_argument('--batch', type=int, default=128)
    parser.add_argument('--lr', type=float, default=5e-5)
    parser.add_argument('--workers', type=int, default=18)
    parser.add_argument('--device', default='cuda')
    parser.add_argument('--revision', default='branch-targets-20261114')
    args = parser.parse_args()
    torch.set_num_threads(4)
    base, vocabulary = load(args.base)
    gem, gem_vocabulary = load(args.gem)
    if gem_vocabulary.symbols != vocabulary.symbols:
        raise ValueError('Policies use different vocabularies')
    models = {'frozenCurrent': load(args.frozen_current), 'anchor417': load(args.frozen_417), 'gem': (gem, gem_vocabulary)}
    configs = configurations('sage', args.games, args.offset, args.revision)
    for index, config in enumerate(configs):
        config.update(profile=False, gemPolicy='gem', **({'sageRefineFirst': True} if index % 2 else {}))
    started = time.time()
    observations = []
    with GameRuntime() as runtime:
        for start in range(0, len(configs), 384):
            # Every decision of the learner seat, whichever network answered it.
            output = runtime.run(base, vocabulary, configs[start:start + 384], workers=args.workers,
                                 device=args.device, models=models, binary=False, collect_states=True)
            for result in output['results']:
                observations.extend(move['observation'] for move in result.get('trajectory', []))
            print(json.dumps(dict(games=start + 384, states=len(observations), seconds=round(time.time() - started))), flush=True)
    gem_id = vocabulary.id('number:gem')
    if gem_id == 1: raise ValueError('number:gem missing from vocabulary')
    gem_states = [o for o in observations if holds_gem(o, gem_id)]
    other_states = [o for o in observations if not holds_gem(o, gem_id)]
    print(json.dumps(dict(gem_states=len(gem_states), other_states=len(other_states))), flush=True)

    device = args.device
    base.to(device).eval(); gem.to(device).eval()
    prepared = {'gem': [prepare_observation(o, vocabulary) for o in gem_states],
                'other': [prepare_observation(o, vocabulary) for o in other_states]}

    def targets(teacher, items):
        out = []
        with torch.no_grad():
            for start in range(0, len(items), 256):
                logits = teacher.policy_logits(collate_prepared(items[start:start + 256], device))
                out.extend(row[torch.isfinite(row)].softmax(-1).cpu() for row in logits)
        return out
    labels = {'gem': targets(gem, prepared['gem']), 'other': targets(base, prepared['other'])}
    student, _ = load(args.base)
    student.to(device).train()
    optimizer = torch.optim.AdamW(list(student.actor.parameters()) + list(student.score.parameters()), lr=args.lr)
    rng = random.Random(1)
    history = []

    def kl(kind, count):
        index = [rng.randrange(len(prepared[kind])) for _ in range(count)]
        logits = student.policy_logits(collate_prepared([prepared[kind][i] for i in index], device))
        log_probabilities = logits.log_softmax(-1)
        total = 0.
        for row, i in zip(log_probabilities, index):
            target = labels[kind][i].to(device)
            values = row[torch.isfinite(row)]
            total = total + (target * (target.clamp_min(1e-30).log() - values)).sum()
        return total / count

    for step in range(1, args.steps + 1):
        gem_loss = kl('gem', args.batch // 2)
        other_loss = kl('other', args.batch // 2)
        loss = gem_loss + other_loss
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(student.parameters(), 1.)
        optimizer.step()
        if step % 250 == 0 or step == 1:
            history.append(dict(step=step, gem_kl=float(gem_loss), other_kl=float(other_loss)))
            print(json.dumps(history[-1]), flush=True)
    saved = student.checkpoint(vocabulary)
    saved.update(merge=dict(base=str(args.base), gem=str(args.gem), games=args.games, gem_states=len(gem_states),
                            other_states=len(other_states), steps=args.steps, history=history))
    torch.save(saved, args.output)
    print('saved', args.output)


if __name__ == '__main__':
    main()
