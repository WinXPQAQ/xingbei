"""Terminal-only PPO prototype; no game-production dependencies or deployment."""
import argparse
import asyncio
import hashlib
import json
import os
import pathlib
import random
import shutil
import time

import torch
from model import Policy, SCHEMA, batch
from rollout import collect
from schedule import training_configs


def update(model, optimizer, rows, device, imitation, epochs=3, batch_size=128):
    model.train()
    losses = []
    for _ in range(epochs):
        order = torch.randperm(len(rows)).tolist()
        for offset in range(0, len(order), batch_size):
            selected = [rows[index] for index in order[offset:offset + batch_size]]
            logits, values = model(*batch(selected, device))
            distribution = torch.distributions.Categorical(logits=logits)
            choices = torch.tensor([row['choice'] for row in selected], device=device)
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
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            losses.append(float(loss.detach()))
    return sum(losses) / max(1, len(losses))


def checkpoint(path, model, optimizer, completed, args):
    temporary = path.with_suffix('.tmp')
    torch.save({'schema': SCHEMA, 'model': model.state_dict(), 'optimizer': optimizer.state_dict(),
                'featureEncoding': model.feature_encoding,
                'completed': completed, 'args': vars(args), 'torch_rng': torch.get_rng_state(),
                'cuda_rng': torch.cuda.get_rng_state_all() if torch.cuda.is_available() else [],
                'python_rng': random.getstate(), 'baseline': 'd1560abd1be87b1aa5a56a33f550903508d23ac2',
                'sourceHashes': {source.name: hashlib.sha256(source.read_bytes()).hexdigest()
                                 for source in pathlib.Path(__file__).parent.iterdir() if source.suffix in ('.py', '.mjs')},
                'torchVersion': torch.__version__}, temporary)
    os.replace(temporary, path)


async def run(args):
    torch.set_num_threads(args.threads)
    torch.manual_seed(args.seed)
    random.seed(args.seed)
    device = torch.device(args.device)
    model = Policy(feature_encoding=args.encoding).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=3e-4)
    args.output.mkdir(parents=True, exist_ok=True)
    path = args.output / 'checkpoint.pt'
    if path.exists() and not args.resume:
        raise ValueError('Existing checkpoint: use --resume or a fresh output directory')
    completed = 0
    if args.resume:
        # Load only a trusted locally generated checkpoint, including RNG state.
        saved = torch.load(args.resume, map_location=device, weights_only=False)
        if saved['schema'] != SCHEMA:
            raise ValueError('Checkpoint feature schema mismatch')
        if saved.get('featureEncoding', 'legacy-v2') != args.encoding:
            raise ValueError('Checkpoint feature encoding mismatch')
        for key in ('seed', 'first_seed', 'games', 'warmup'):
            if saved['args'][key] != vars(args)[key]:
                raise ValueError(f'Resume changed rollout schedule: {key}')
        model.load_state_dict(saved['model'])
        optimizer.load_state_dict(saved['optimizer'])
        completed = saved['completed']
        torch.set_rng_state(saved['torch_rng'].cpu())
        if saved['cuda_rng'] and device.type == 'cuda':
            torch.cuda.set_rng_state_all([state.cpu() for state in saved['cuda_rng']])
        random.setstate(saved['python_rng'])
    for iteration in range(completed, args.updates):
        started = time.perf_counter()
        imitation = iteration < args.warmup
        configs = training_configs(args.first_seed, iteration, args.games, args.seed, imitation)
        rows, results, batches = await collect(model, configs, args.workers, device, teacher='v1.5' if imitation else None)
        if not rows:
            raise RuntimeError('No terminated trajectories; refusing an empty training update')
        loss = update(model, optimizer, rows, device, imitation, epochs=args.epochs)
        checkpoint(path, model, optimizer, iteration + 1, args)
        if iteration + 1 == args.warmup:
            shutil.copy2(path, args.output / 'imitation.pt')
        report = {'iteration': iteration, 'phase': 'imitation' if imitation else 'terminal-ppo',
                  'rolloutPolicyVersion': iteration, 'decisionsUsed': len(rows),
                  'totalDecisions': sum(result['decisions'] for result in results),
                  'truncatedExcluded': sum(result['truncated'] for result in results),
                  'loss': loss, 'seconds': time.perf_counter() - started,
                  'meanInferenceBatch': sum(batches) / max(1, len(batches)), 'games': results}
        with (args.output / 'metrics.jsonl').open('a') as stream:
            stream.write(json.dumps(report) + '\n')
        print(json.dumps({key: value for key, value in report.items() if key != 'games'}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=pathlib.Path, required=True)
    parser.add_argument('--resume', type=pathlib.Path)
    parser.add_argument('--device', default='cpu')
    parser.add_argument('--encoding', choices=['legacy-v2', 'categorical-seats-v3'], default='legacy-v2')
    parser.add_argument('--seed', type=int, default=41)
    parser.add_argument('--first-seed', type=int, default=220000000)
    parser.add_argument('--updates', type=int, default=3)
    parser.add_argument('--warmup', type=int, default=1)
    parser.add_argument('--games', type=int, default=12)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--threads', type=int, default=2)
    parser.add_argument('--epochs', type=int, default=3)
    asyncio.run(run(parser.parse_args()))
