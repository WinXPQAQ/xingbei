"""Source-disjoint value fitting with balanced samples and held-out rollback."""
import copy
import hashlib
import math
import random

import torch
from torch.nn import functional as F

from learning import parameter_groups
from prepared import PreparedObservations


def source_fraction(source_seed):
    digest = hashlib.sha256(f'critic-validation-v1:{source_seed}'.encode()).digest()
    return int.from_bytes(digest[:8], 'big') / 2**64


def group_rows(rows):
    sources = {}
    for row in rows:
        source = row['source_seed']
        game = sources.setdefault(source, {}).setdefault(row['game_id'], {})
        roots = game.setdefault(row['seat'], {})
        root = row.get('root_id', row.get('learning', {}).get('requestId'))
        if root is None:
            raise ValueError('Critic balancing requires a root-request identity')
        roots.setdefault(root, []).append(row)
    return sources


def sample_source(games, rng):
    game = rng.choice(list(games.values()))
    seat = rng.choice(list(game.values()))
    root = rng.choice(list(seat.values()))
    return rng.choice(root)


def validation_rows(sources, limit=24):
    """Fixed source-balanced samples, independent of minibatch RNG consumption."""
    selected = []
    for source, games in sources.items():
        rng = random.Random(f'critic-validation-observations-v1:{source}')
        selected.extend(sample_source(games, rng) for _ in range(limit))
    return selected


def value_metrics(model, prepared, rows, batch_size, device, loss):
    total_loss = squared = brier = negative_log = confidence_error = 0.
    buckets = [dict(count=0, predicted=0., won=0.) for _ in range(10)]
    styled = any(row.get('reward_style', 'win') != 'win' for row in rows)
    was_training = model.training
    model.eval()
    with torch.no_grad():
        for start in range(0, len(rows), batch_size):
            selected = rows[start:start + batch_size]
            batch = prepared.collate([row['observation'] for row in selected], device)
            logits = model.value_logits(batch)
            values = logits.tanh() * model.value_scale
            targets = torch.tensor([row['return'] for row in selected], device=device)
            terminal = torch.tensor([row['terminal_return'] for row in selected], device=device)
            potential = torch.tensor([row.get('potential', 0.) for row in selected], device=device)
            probability = ((values + potential + 1) / 2).clamp(1e-6, 1-1e-6)
            labels = (terminal + 1) / 2
            objective = (F.binary_cross_entropy_with_logits(2*logits, (targets+1)/2, reduction='sum')
                         if loss == 'bce' else (values-targets).square().sum())
            total_loss += float(objective)
            diagnostic_target = targets if styled else terminal - potential
            squared += float((values - diagnostic_target).square().sum())
            if not styled:
                brier += float((probability-labels).square().sum())
                negative_log += float(F.binary_cross_entropy(probability, labels, reduction='sum'))
                for prediction, won in zip(probability.cpu().tolist(), labels.cpu().tolist()):
                    bucket = buckets[min(9, int(prediction*10))]
                    bucket['count'] += 1
                    bucket['predicted'] += prediction
                    bucket['won'] += won
    model.train(was_training)
    count = len(rows)
    for bucket in buckets:
        confidence_error += abs(bucket['predicted'] - bucket['won'])
    return dict(samples=count, objective=total_loss/count, mse=squared/count,
                value_semantics='style_return' if styled else 'terminal_win',
                brier=None if styled else brier/count, nll=None if styled else negative_log/count,
                ece=None if styled else confidence_error/count, calibration=[] if styled else buckets)


def fit_critic(model, vocab, optimizer, rows, batch_size, device, max_updates=32,
               validation_fraction=.2, loss='bce'):
    if batch_size < 1 or max_updates < 0 or not 0 < validation_fraction < 1:
        raise ValueError('Invalid critic fitting configuration')
    if loss not in ('bce', 'mse'):
        raise ValueError('Unknown critic objective')
    if loss == 'bce' and (model.value_scale != 1 or any(
            row['return'] not in (-1, 1) or row.get('potential', 0) != 0
            or row.get('reward_style', 'win') != 'win' for row in rows)):
        raise ValueError('Bernoulli critic fitting requires unshaped terminal returns')
    sources = group_rows(rows)
    valid = {source: games for source, games in sources.items()
             if source_fraction(source) < validation_fraction}
    train = {source: games for source, games in sources.items() if source not in valid}
    metrics = dict(loss=loss, updates=0, best_update=0, train_sources=len(train),
                   validation_sources=len(valid), source_overlap=0, skipped=False)
    if not train or not valid:
        return {**metrics, 'skipped': True, 'reason': 'Insufficient source-disjoint groups'}
    held_out = validation_rows(valid)
    prepared = PreparedObservations([row['observation'] for row in rows], vocab)
    parameters = parameter_groups(model)['critic']

    def snapshot():
        return copy.deepcopy((model.critic.state_dict(), model.value.state_dict(), optimizer.state_dict()))

    def validate():
        result = value_metrics(model, prepared, held_out, batch_size, device, loss)
        if not math.isfinite(result['objective']):
            raise RuntimeError('Nonfinite held-out critic loss')
        return result

    was_training = model.training
    best_metrics = validate()
    metrics['validation_before'] = best_metrics
    best = snapshot()
    model.train()
    keys = list(train)
    training_losses = []
    for update in range(1, max_updates+1):
        chosen = random.sample(keys, min(batch_size, len(keys)))
        selected = [sample_source(train[source], random) for source in chosen]
        batch = prepared.collate([row['observation'] for row in selected], device)
        logits = model.value_logits(batch)
        targets = torch.tensor([row['return'] for row in selected], device=device)
        objective = (F.binary_cross_entropy_with_logits(2*logits, (targets+1)/2)
                     if loss == 'bce' else F.mse_loss(logits.tanh()*model.value_scale, targets))
        if not torch.isfinite(objective):
            raise RuntimeError('Nonfinite critic loss')
        optimizer.zero_grad(set_to_none=True)
        objective.backward()
        torch.nn.utils.clip_grad_norm_(parameters, 1)
        optimizer.step()
        metrics['updates'] = update
        training_losses.append(float(objective.detach()))
        if update % 8 == 0 or update == max_updates:
            current = validate()
            if current['objective'] < best_metrics['objective']:
                best_metrics = current
                best = snapshot()
                metrics['best_update'] = update
    critic_state, value_state, optimizer_state = best
    model.critic.load_state_dict(critic_state)
    model.value.load_state_dict(value_state)
    optimizer.load_state_dict(optimizer_state)
    optimizer.zero_grad(set_to_none=True)
    model.train(was_training)
    metrics['validation_after'] = best_metrics
    metrics['mean_training_loss'] = sum(training_losses)/len(training_losses) if training_losses else None
    return metrics
