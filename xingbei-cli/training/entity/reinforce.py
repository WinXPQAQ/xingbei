"""Clipped PPO with undiscounted terminal Monte Carlo returns.

No shaping rewards, privileged critic, per-subdecision discount or teacher labels.
Rounds use a frozen policy for collection, then update on only completed games.
"""
import argparse
import asyncio
import json
import random
import time
from pathlib import Path
import torch
from model import EntityPolicy, collate
from pool import run_games, ROSTERS
from league import training_configs


def terminal_samples(results):
    rows = []
    for result in results:
        if not result['terminated'] or result['truncated']: continue
        rewards = result['rewards']
        if not rewards or any(value not in (-1, 1) for value in rewards.values()):
            raise ValueError('Invalid terminal team rewards')
        for decision in result.get('trajectory', []):
            if decision['seat'] not in result.get('learnerSeats',range(6)): raise ValueError('Opponent trajectory leaked into learner')
            reward = rewards[str(decision['seat'])]
            rows.append({**decision, 'return': reward, 'advantage': reward-decision['old_value']})
    return rows


def update(model, vocabulary, optimizer, rows, *, batch_size, epochs, device):
    if not rows: raise ValueError('No completed trajectories; truncated games are not losses')
    started = time.perf_counter()
    model.train(); stats = dict(updates=0, policy_loss=0., value_loss=0., entropy=0.)
    for _ in range(epochs):
        random.shuffle(rows)
        for start in range(0, len(rows), batch_size):
            selected = rows[start:start+batch_size]
            batch = collate([row['observation'] for row in selected], vocabulary, device)
            logits, values = model(batch)
            distribution = torch.distributions.Categorical(logits=logits)
            tensor = lambda data, dtype=torch.float32: torch.tensor(data, dtype=dtype, device=device)
            log_prob = distribution.log_prob(tensor([r['choice'] for r in selected], torch.long))
            ratio = (log_prob-tensor([r['old_log_prob'] for r in selected])).exp()
            advantage = tensor([r['advantage'] for r in selected])
            policy_loss = -torch.minimum(ratio*advantage, ratio.clamp(0.8, 1.2)*advantage).mean()
            value_loss = (values-tensor([r['return'] for r in selected])).square().mean()
            entropy = distribution.entropy().mean()
            loss = policy_loss + 0.5*value_loss - 0.01*entropy
            if not torch.isfinite(loss): raise RuntimeError('Nonfinite PPO loss')
            optimizer.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1); optimizer.step()
            stats['updates'] += 1
            for name, value in [('policy_loss',policy_loss),('value_loss',value_loss),('entropy',entropy)]:
                stats[name] += float(value.detach())
    for name in ['policy_loss','value_loss','entropy']: stats[name] /= stats['updates']
    stats['seconds'] = time.perf_counter()-started
    return stats


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('checkpoint'); parser.add_argument('output')
    parser.add_argument('--rounds', type=int, default=1, help='Additional collection/update rounds')
    parser.add_argument('--games', type=int); parser.add_argument('--workers', type=int, default=16)
    parser.add_argument('--batch', type=int); parser.add_argument('--epochs', type=int)
    parser.add_argument('--seed', type=int, default=211102700)
    parser.add_argument('--device', default='cpu')
    parser.add_argument('--opponents', nargs='+', help='Rule policy versions or self, rotated by round')
    parser.add_argument('--league', action='store_true')
    parser.add_argument('--positions')
    parser.add_argument('--history')
    parser.add_argument('--revision', default='development')
    args = parser.parse_args()
    if Path(args.output).exists() or Path(args.output+'.json').exists(): parser.error('Output exists')
    if args.rounds < 1 or args.workers < 1: parser.error('rounds and workers must be positive')
    torch.set_num_threads(2)
    checkpoint = torch.load(args.checkpoint, map_location='cpu', weights_only=False)
    previous = checkpoint.get('rl')
    config = dict(games=args.games or (previous['config']['games'] if previous else 6),
                  batch=args.batch or (previous['config']['batch'] if previous else 32),
                  epochs=args.epochs or (previous['config']['epochs'] if previous else 2),
                  opponents=args.opponents or (previous['config']['opponents'] if previous else ['v1.8.0-preview.1', 'self']),
                  seed=previous['config']['seed'] if previous else args.seed)
    if min(config['games'], config['batch'], config['epochs']) < 1: parser.error('games, batch and epochs must be positive')
    if previous and config != previous['config']: raise ValueError('Resume settings differ; use a new explicit experiment')
    random.seed(config['seed']); torch.manual_seed(config['seed'])
    model, vocabulary = EntityPolicy.restore(checkpoint); model.to(args.device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-4)
    if previous:
        optimizer.load_state_dict(checkpoint['optimizer'])
        random.setstate(checkpoint['random_state']); torch.set_rng_state(checkpoint['torch_rng'])
        if args.device == 'cuda' and checkpoint['cuda_rng']: torch.cuda.set_rng_state_all(checkpoint['cuda_rng'])
    rounds = previous['rounds'] if previous else 0
    for round_index in range(rounds, rounds+args.rounds):
        destination = args.output if args.rounds == 1 else f'{args.output}.round-{round_index+1}.pt'
        if Path(destination).exists() or Path(destination+'.json').exists():
            raise ValueError(f'Output exists: {destination}')
    reports = []
    positions = [json.loads(line) for line in Path(args.positions).read_text().splitlines()] if args.positions else []
    completed = checkpoint.get('completed_games',0)
    hero_coverage = checkpoint.get('hero_coverage',{})
    models = {}
    if args.history:
        models['history'] = EntityPolicy.restore(torch.load(args.history,map_location='cpu',weights_only=False))
    if previous:
        torch.set_rng_state(checkpoint['torch_rng'])
        if args.device == 'cuda' and checkpoint['cuda_rng']: torch.cuda.set_rng_state_all(checkpoint['cuda_rng'])
    excluded = set(checkpoint.get('validation_seeds', []))
    for round_index in range(rounds, rounds+args.rounds):
        opponent = config['opponents'][round_index % len(config['opponents'])]
        configs = [dict(seed=config['seed']+round_index*config['games']+i,
                        heroIds=ROSTERS[(round_index*config['games']+i) % 3], start=i % 6) for i in range(config['games'])]
        curriculum = None
        if args.league:
            configs,curriculum=training_configs(index=round_index*config['games'],count=config['games'],completed=completed,
                revision=args.revision,positions=positions,excluded=excluded,historical='model:history' if models else None)
        rollout = asyncio.run(run_games(model, vocabulary, configs, workers=args.workers, device=args.device,
                                       opponent=None if opponent == 'self' else opponent, trajectory=True,models=models))
        for game in rollout['results']:
            for hero in game['heroIds']: hero_coverage[hero] = hero_coverage.get(hero,0)+1
        rows = terminal_samples(rollout['results'])
        metrics = update(model, vocabulary, optimizer, rows, batch_size=config['batch'], epochs=config['epochs'], device=args.device)
        completed += sum(r['terminated'] for r in rollout['results'])
        report = dict(hero_coverage=hero_coverage, curriculum=curriculum, completed_total=completed, round=round_index+1, opponent='league-mix' if args.league else opponent, opponent_counts={key:sum(c.get('opponent')==key for c in configs) for key in ['self','v1.9.0-preview.1','model:history']}, decisions=len(rows),
                      completed=sum(r['terminated'] for r in rollout['results']),
                      truncated=sum(r['truncated'] for r in rollout['results']), rollout=rollout['stats'], update=metrics,
                      games=[{k:v for k,v in result.items() if k != 'trajectory'} for result in rollout['results']])
        reports.append(report)
        # Every completed round is a recovery point. Multiple rounds get separate
        # files; never overwrite a previous checkpoint or the deployed service.
        destination = args.output if args.rounds == 1 else f'{args.output}.round-{round_index+1}.pt'
        saved = model.checkpoint(vocabulary)
        saved.update(hero_coverage=hero_coverage, completed_games=completed, revision=args.revision, validation_seeds=list(excluded), curriculum=curriculum, historical_checkpoint=args.history, rl=dict(rounds=round_index+1, config=config), optimizer=optimizer.state_dict(),
                     random_state=random.getstate(), torch_rng=torch.get_rng_state(),
                     cuda_rng=torch.cuda.get_rng_state_all() if torch.cuda.is_available() else [],
                     parent_checkpoint=args.checkpoint)
        Path(destination).parent.mkdir(parents=True, exist_ok=True)
        with open(destination, 'xb') as file: torch.save(saved, file)
        with open(destination+'.json', 'x') as file: json.dump(report, file, indent=2)
        print(json.dumps({k:v for k,v in report.items() if k != 'games'}), flush=True)
    return reports


if __name__ == '__main__': main()
