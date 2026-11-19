"""Hand belief model: P(card class in each other player's hand | observer's information).

Collect: specialist games (same lineups/opponents as training, never the
evaluation seeds). At each top-level action decision of the focal seat the
simulator attaches the true hands of the five other seats as a training label.
The observation is the policy's ordinary observation, which includes the
public state and the last 32 public actions.

Model: an entity encoder (initialized from the policy actor) whose contextual
player entities 1..5 (relative seats) are scored against 24 printed card
classes. Loss: cross-entropy of each hand's class composition.

    python belief.py collect OUT.pt --checkpoint CKPT --frozen-current .. --frozen-417 .. --games 3000
    python belief.py train DATA.pt OUT.pt --checkpoint CKPT
"""
import argparse
import json
import math
from pathlib import Path
import random
import time

import torch
from torch import nn

from model import EntityPolicy, EntityEncoder, collate_prepared, prepare_observation

CLASSES = 25  # training/entity/belief.mjs CARD_CLASSES, including 'other'


class BeliefNet(nn.Module):
    def __init__(self, vocabulary_size, width=96, layers=2):
        super().__init__()
        self.config = dict(vocabulary_size=vocabulary_size, width=width, layers=layers)
        self.encoder = EntityEncoder(vocabulary_size, width, layers)
        self.head = nn.Sequential(nn.Linear(width * 2, width), nn.GELU(), nn.Linear(width, CLASSES))

    def correction(self, batch):
        """Log multiplicative correction to the resampling pool, [batch, 5, classes]."""
        return self.forward(batch)

    def forward(self, batch):
        size, total = batch['mask'].shape
        count = batch['entities']
        raw = self.encoder.tokens(batch)
        linked = self.encoder.relate(raw, batch).reshape(size, total, self.encoder.width)
        contextual = self.encoder.transformer(linked[:, :count], src_key_padding_mask=batch['mask'][:, :count])
        question = contextual[torch.arange(size, device=contextual.device), batch['question']]
        players = contextual[:, 1:6]  # relative seats 1..5
        query = question[:, None].expand(-1, 5, -1)
        return self.head(torch.cat((players, query), dim=-1))  # [batch, 5, classes] logits


def load_policy(path):
    return EntityPolicy.restore(torch.load(path, map_location='cpu', weights_only=False))


def collect(args):
    from pool import GameRuntime
    from specialists import configurations
    model, vocabulary = load_policy(args.checkpoint)
    models = {'frozenCurrent': load_policy(args.frozen_current), 'anchor417': load_policy(args.frozen_417)}
    configs = configurations('sage', args.games, args.offset, args.revision)
    for index, config in enumerate(configs):
        config.update(profile=False, beliefLabels=True)
        if index % 4 == 3: config['sageRefineFirst'] = True  # also cover gem-holding states
    rows, started = [], time.time()
    with GameRuntime() as runtime:
        for start in range(0, len(configs), 384):
            output = runtime.run(model, vocabulary, configs[start:start + 384], workers=args.workers,
                                 device=args.device, models=models, binary=True)
            for game, result in enumerate(output['results']):
                for item in result.get('recorded') or []:
                    if 'belief' in item['record']:
                        rows.append(dict(observation=item['observation'], counts=item['record']['belief'],
                                         pool=item['record']['pool'], game=start + game))
            print(json.dumps(dict(games=start + 384, samples=len(rows), seconds=round(time.time() - started))), flush=True)
    torch.save(dict(rows=rows, symbols=vocabulary.symbols, checkpoint=str(args.checkpoint)), args.output)


def tensors(rows, vocabulary):
    prepared = [prepare_observation(row['observation'], vocabulary) for row in rows]
    counts = torch.tensor([row['counts'] for row in rows], dtype=torch.float32)  # [n, 5, classes]
    pool = torch.tensor([row['pool'] for row in rows], dtype=torch.float32)  # [n, classes]
    return prepared, counts, pool.clamp_min(1e-3).log()[:, None, :].expand(-1, 5, -1).contiguous()


def loss_terms(logits, counts):
    sizes = counts.sum(-1)
    log_probabilities = logits.log_softmax(-1)
    nll = -(counts * log_probabilities).sum(-1)  # summed over cards in each hand
    return nll.sum(), sizes.sum()


def evaluate(net, prepared, counts, prior, device, batch=256):
    net.eval()
    total = cards = 0.
    with torch.no_grad():
        for start in range(0, len(prepared), batch):
            b = collate_prepared(prepared[start:start + batch], device)
            nll, n = loss_terms(prior[start:start + batch].to(device) + net(b), counts[start:start + batch].to(device))
            total += float(nll); cards += float(n)
    net.train()
    return total / max(1, cards)


def train(args):
    from model import Vocabulary
    data = torch.load(args.data, map_location='cpu', weights_only=False)
    policy, vocabulary = load_policy(args.checkpoint)
    if data['symbols'] != vocabulary.symbols:
        raise ValueError('Data vocabulary differs from the checkpoint')
    rows = data['rows']
    games = sorted({row['game'] for row in rows})
    random.Random(7).shuffle(games)
    held = set(games[:max(1, len(games) // 10)])
    train_rows = [r for r in rows if r['game'] not in held]
    test_rows = [r for r in rows if r['game'] in held]
    train_x, train_y, train_prior = tensors(train_rows, vocabulary)
    test_x, test_y, test_prior = tensors(test_rows, vocabulary)
    # Baselines: global class frequency, and the uniform deal from the resampling pool.
    frequency = train_y.sum((0, 1)); frequency = frequency / frequency.sum()
    baseline = float(-(test_y * frequency.clamp_min(1e-9).log()).sum() / test_y.sum())
    pool_baseline = float(-(test_y * test_prior.log_softmax(-1)).sum() / test_y.sum())
    net = BeliefNet(len(vocabulary.symbols), policy.config['width'], policy.config['layers'])
    net.encoder.load_state_dict(policy.actor.state_dict())
    with torch.no_grad():  # start exactly at the uniform deal (zero correction)
        net.head[-1].weight.zero_(); net.head[-1].bias.zero_()
    net.to(args.device)
    optimizer = torch.optim.AdamW(net.parameters(), lr=args.lr, weight_decay=1e-4)
    best, best_state, step, history = float('inf'), None, 0, []
    order = list(range(len(train_x)))
    started = time.time()
    while step < args.steps:
        random.shuffle(order)
        for start in range(0, len(order) - args.batch + 1, args.batch):
            index = order[start:start + args.batch]
            batch = collate_prepared([train_x[i] for i in index], args.device)
            nll, n = loss_terms(train_prior[index].to(args.device) + net(batch), train_y[index].to(args.device))
            optimizer.zero_grad(set_to_none=True)
            (nll / n).backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), 1.)
            optimizer.step()
            step += 1
            if step % args.eval_every == 0 or step == args.steps:
                score = evaluate(net, test_x, test_y, test_prior, args.device)
                history.append(dict(step=step, test_nll_per_card=score, seconds=round(time.time() - started)))
                print(json.dumps(history[-1]), flush=True)
                if score < best:
                    best, best_state = score, {k: v.detach().cpu().clone() for k, v in net.state_dict().items()}
            if step >= args.steps: break
    net.load_state_dict(best_state)
    report = dict(train_samples=len(train_rows), test_samples=len(test_rows), test_games=len(held),
                  frequency_nll_per_card=baseline, pool_nll_per_card=pool_baseline, best_test_nll_per_card=best,
                  perplexity_frequency=math.exp(baseline), perplexity_pool=math.exp(pool_baseline),
                  perplexity_model=math.exp(best), history=history)
    torch.save(dict(config=net.config, state=net.state_dict(), symbols=vocabulary.symbols, report=report), args.output)
    print(json.dumps({k: v for k, v in report.items() if k != 'history'}))


def restore(path, device='cpu'):
    saved = torch.load(path, map_location='cpu', weights_only=False)
    net = BeliefNet(**saved['config'])
    net.load_state_dict(saved['state'])
    return net.to(device).eval(), saved['symbols']


def weights_for(net, observations, vocabulary, seats, device):
    """Multiplicative pool corrections for the other five players, keyed by absolute player id."""
    with torch.no_grad():
        batch = collate_prepared([prepare_observation(o, vocabulary) for o in observations], device)
        probabilities = net(batch).clamp(-8, 8).exp().cpu().tolist()
    return [{(seat + offset) % 6: probabilities[b][offset - 1] for offset in range(1, 6)}
            for b, seat in enumerate(seats)]


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    c = sub.add_parser('collect')
    c.add_argument('output', type=Path)
    c.add_argument('--checkpoint', type=Path, required=True)
    c.add_argument('--frozen-current', type=Path, required=True)
    c.add_argument('--frozen-417', type=Path, required=True)
    c.add_argument('--games', type=int, default=3072)
    c.add_argument('--offset', type=int, default=3000000)
    c.add_argument('--workers', type=int, default=18)
    c.add_argument('--device', default='cuda')
    c.add_argument('--revision', default='branch-targets-20261114')
    t = sub.add_parser('train')
    t.add_argument('data', type=Path)
    t.add_argument('output', type=Path)
    t.add_argument('--checkpoint', type=Path, required=True)
    t.add_argument('--steps', type=int, default=6000)
    t.add_argument('--batch', type=int, default=128)
    t.add_argument('--lr', type=float, default=1e-4)
    t.add_argument('--eval-every', type=int, default=500)
    t.add_argument('--device', default='cuda')
    args = parser.parse_args()
    torch.set_num_threads(4)
    collect(args) if args.command == 'collect' else train(args)
