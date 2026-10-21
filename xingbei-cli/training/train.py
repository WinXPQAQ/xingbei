"""Terminal-only PPO prototype; no game-production dependencies or deployment."""
import argparse
import asyncio
import hashlib
import json
import math
import os
import pathlib
import random
import shutil
import time

import torch
from model import Policy, SCHEMA, batch, load_policy_state
from rollout import collect, SAMPLING_VERSION
from schedule import training_configs
from control import assert_training_start_allowed


def update(model, optimizer, rows, device, imitation, epochs=3, batch_size=128, diagnostics=None):
    model.train()
    losses = []
    totals = {key: 0.0 for key in ('policyLoss', 'valueLoss', 'entropy', 'approximateKL', 'clipFraction')}
    samples = 0
    for _ in range(epochs):
        order = torch.randperm(len(rows)).tolist()
        for offset in range(0, len(order), batch_size):
            selected = [rows[index] for index in order[offset:offset + batch_size]]
            logits, values = model(*batch(selected, device))
            temperatures = torch.tensor([row.get('temperature', 1.0) for row in selected], device=device)
            if not torch.isfinite(temperatures).all() or (temperatures <= 0).any():
                raise ValueError("Invalid trajectory sampling temperature")
            distribution = torch.distributions.Categorical(logits=logits / temperatures[:, None])
            choices = torch.tensor([row.get('teacherChoice', row['choice']) if imitation else row['choice'] for row in selected], device=device)
            returns = torch.tensor([row['return'] for row in selected], device=device, dtype=torch.float32)
            logp = distribution.log_prob(choices)
            if imitation:
                policy_loss = -logp.mean()
            else:
                old_logp = torch.tensor([row['logp'] for row in selected], device=device)
                old_value = torch.tensor([row['value'] for row in selected], device=device)
                # Undiscounted Monte Carlo team return. No extra discount for
                # intervening seats or multiple subchoices within one action.
                advantage = returns - old_value
                ratio = (logp - old_logp).exp()
                policy_loss = -torch.minimum(ratio * advantage, ratio.clamp(0.8, 1.2) * advantage).mean()
            value_loss = (values - returns).square().mean()
            # No entropy bonus: only terminal outcome defines the RL objective.
            loss = policy_loss + 0.5 * value_loss
            if not torch.isfinite(loss):
                raise RuntimeError('Non-finite optimization loss')
            if diagnostics is not None:
                count = len(selected)
                samples += count
                totals['policyLoss'] += float(policy_loss.detach()) * count
                totals['valueLoss'] += float(value_loss.detach()) * count
                totals['entropy'] += float(distribution.entropy().mean().detach()) * count
                if not imitation:
                    log_ratio = logp - old_logp
                    totals['approximateKL'] += float((ratio - 1 - log_ratio).mean().detach()) * count
                    totals['clipFraction'] += float(((ratio < 0.8) | (ratio > 1.2)).float().mean().detach()) * count
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            losses.append(float(loss.detach()))
    if diagnostics is not None:
        diagnostics.update({key: value / max(1, samples) for key, value in totals.items()})
        diagnostics['scope'] = 'minibatch-weighted observations during updates, not a final full-policy KL'
        diagnostics['terminalReturnMean'] = sum(row['return'] for row in rows) / len(rows)
    return sum(losses) / max(1, len(losses))


def checkpoint(path, model, optimizer, completed, args):
    temporary = path.with_suffix('.tmp')
    torch.save({'schema': SCHEMA, 'model': model.state_dict(), 'optimizer': optimizer.state_dict(),
                'featureEncoding': model.feature_encoding,
                'separateCritic': model.separate_critic,
                'baselineVersion': model.baseline_version, 'baselineProbability': model.baseline_probability,
                'previewVersion': 1 if model.baseline_version else None,
                'samplingVersion': SAMPLING_VERSION,
                'completed': completed, 'args': vars(args), 'torch_rng': torch.get_rng_state(),
                'cuda_rng': torch.cuda.get_rng_state_all() if torch.cuda.is_available() else [],
                'python_rng': random.getstate(), 'baseline': 'd1560abd1be87b1aa5a56a33f550903508d23ac2',
                'sourceHashes': {source.name: hashlib.sha256(source.read_bytes()).hexdigest()
                                 for source in pathlib.Path(__file__).parent.iterdir() if source.suffix in ('.py', '.mjs')},
                'torchVersion': torch.__version__}, temporary)
    os.replace(temporary, path)


def initialize_weights(path, model, device):
    saved = torch.load(path, map_location=device, weights_only=False)
    if saved['schema'] != SCHEMA or saved.get('featureEncoding', 'legacy-v2') != model.feature_encoding:
        raise ValueError('Initialization feature encoding mismatch')
    load_policy_state(model, saved)
    return {'checkpoint': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'parentCompleted': saved['completed'], 'criticSeparated': model.separate_critic and not saved.get('separateCritic', False),
            'parentSamplingVersion': saved.get('samplingVersion', 1),
            'optimizerAndRng': 'fresh; explicit new curriculum, not resume'}


async def run(args):
    assert_training_start_allowed()
    if not math.isfinite(args.temperature) or args.temperature <= 0:
        raise ValueError("Sampling temperature must be finite and positive")
    torch.set_num_threads(args.threads)
    torch.manual_seed(args.seed)
    random.seed(args.seed)
    device = torch.device(args.device)
    model = Policy(feature_encoding=args.encoding, separate_critic=args.separate_critic, baseline_version=args.baseline, baseline_probability=args.baseline_probability).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=args.learning_rate if args.learning_rate is not None else 3e-4)
    args.output.mkdir(parents=True, exist_ok=True)
    path = args.output / 'checkpoint.pt'
    if path.exists() and not args.resume:
        raise ValueError('Existing checkpoint: use --resume or a fresh output directory')
    completed = 0
    if args.baseline and (args.warmup or not args.separate_critic or args.encoding != 'decision-context-v6'):
        raise ValueError('Residual trial requires warmup=0, separate critic and decision-context-v6')
    if args.initialize:
        args.initialization = initialize_weights(args.initialize, model, device)
    if args.resume:
        # Load only a trusted locally generated checkpoint, including RNG state.
        saved = torch.load(args.resume, map_location=device, weights_only=False)
        if saved['schema'] != SCHEMA:
            raise ValueError('Checkpoint feature schema mismatch')
        if saved.get('samplingVersion', 1) != SAMPLING_VERSION:
            raise ValueError('Sampling version changed; use explicit --initialize for a new curriculum')
        if saved.get('featureEncoding', 'legacy-v2') != args.encoding:
            raise ValueError('Checkpoint feature encoding mismatch')
        if saved['args'].get('dagger', False) != args.dagger:
            raise ValueError('Resume changed imitation execution mode')
        if saved.get('separateCritic', False) != args.separate_critic:
            raise ValueError('Architecture change requires explicit --initialize, not --resume')
        if saved['args'].get('schedule_offset', 0) != args.schedule_offset:
            raise ValueError('Resume changed schedule offset')
        for key in ('seed', 'first_seed', 'games', 'warmup'):
            if saved['args'][key] != vars(args)[key]:
                raise ValueError(f'Resume changed rollout schedule: {key}')
        if saved['args'].get('temperature', 1.0) != args.temperature:
            raise ValueError('Resume changed sampling temperature; use explicit initialization')
        load_policy_state(model, saved)
        optimizer.load_state_dict(saved['optimizer'])
        completed = saved['completed']
        torch.set_rng_state(saved['torch_rng'].cpu())
        if saved['cuda_rng'] and device.type == 'cuda':
            torch.cuda.set_rng_state_all([state.cpu() for state in saved['cuda_rng']])
        random.setstate(saved['python_rng'])
    if args.learning_rate is not None:
        # An explicit optimization override, recorded in args and every metric.
        # Resume still preserves rollout schedule and all optimizer moments.
        for group in optimizer.param_groups:
            group['lr'] = args.learning_rate
    if completed == 0:
        checkpoint(args.output / 'initial.pt', model, optimizer, 0, args)
    for iteration in range(completed, args.updates):
        started = time.perf_counter()
        imitation = iteration < args.warmup
        configs = training_configs(args.first_seed, iteration + args.schedule_offset, args.games, args.seed, imitation and not args.dagger)
        rows, results, batches = await collect(model, configs, args.workers, device, teacher='v1.5' if imitation else None,
                                              execute_teacher=not args.dagger, temperature=args.temperature)
        if not rows:
            raise RuntimeError('No terminated trajectories; refusing an empty training update')
        optimization = {}
        loss = update(model, optimizer, rows, device, imitation, epochs=args.epochs,
                      batch_size=args.batch_size, diagnostics=optimization)
        optimization['learningRate'] = optimizer.param_groups[0]['lr']
        optimization['batchSize'] = args.batch_size
        optimization['samplingTemperature'] = args.temperature
        checkpoint(path, model, optimizer, iteration + 1, args)
        if iteration + 1 == args.warmup:
            shutil.copy2(path, args.output / 'imitation.pt')
        if args.save_every and (iteration + 1) % args.save_every == 0:
            shutil.copy2(path, args.output / f'checkpoint-{iteration + 1}.pt')
        report = {'iteration': iteration, 'phase': ('imitation-on-policy' if args.dagger else 'imitation') if imitation else 'terminal-ppo',
                  'rolloutPolicyVersion': iteration, 'decisionsUsed': len(rows),
                  'totalDecisions': sum(result['decisions'] for result in results),
                  'truncatedExcluded': sum(result['truncated'] for result in results),
                  'loss': loss, 'optimization': optimization, 'seconds': time.perf_counter() - started,
                  'meanInferenceBatch': sum(batches) / max(1, len(batches)), 'games': results}
        with (args.output / 'metrics.jsonl').open('a') as stream:
            stream.write(json.dumps(report) + '\n')
        print(json.dumps({key: value for key, value in report.items() if key != 'games'}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=pathlib.Path, required=True)
    initialization = parser.add_mutually_exclusive_group()
    initialization.add_argument('--resume', type=pathlib.Path)
    initialization.add_argument('--initialize', type=pathlib.Path, help='Copy only model weights; start an explicit fresh curriculum/optimizer/RNG')
    parser.add_argument('--device', default='cpu')
    parser.add_argument('--encoding', choices=['legacy-v2', 'categorical-seats-v3', 'contextual-seats-v4', 'contextual-joint-v5', 'decision-context-v6'], default='legacy-v2')
    parser.add_argument('--baseline', choices=['v1.5'])
    parser.add_argument('--baseline-probability', type=float, default=0.95)
    parser.add_argument('--separate-critic', action='store_true')
    parser.add_argument('--schedule-offset', type=int, default=0)
    parser.add_argument('--seed', type=int, default=41)
    parser.add_argument('--first-seed', type=int, default=220000000)
    parser.add_argument('--updates', type=int, default=3)
    parser.add_argument('--warmup', type=int, default=1)
    parser.add_argument('--dagger', action='store_true', help='During imitation, execute model actions and learn separately recorded teacher labels')
    parser.add_argument('--games', type=int, default=12)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--threads', type=int, default=2)
    parser.add_argument('--epochs', type=int, default=3)
    parser.add_argument('--learning-rate', type=float, help='Explicit optimizer learning rate, including when resuming')
    parser.add_argument('--batch-size', type=int, default=128)
    parser.add_argument('--temperature', type=float, default=1.0, help='Training sampling only; greedy candidate ranking is unchanged')
    parser.add_argument('--save-every', type=int, default=0)
    asyncio.run(run(parser.parse_args()))
