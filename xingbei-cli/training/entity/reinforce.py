"""On-policy PPO experiments with team returns and independent value updates.

Completed games only. Learning signals and optimizer settings are checkpointed.
"""
import argparse
import asyncio
import json
import os
import random
import time
from pathlib import Path
import torch
from model import EntityPolicy
from pool import run_games
from league import catalog, roster, training_configs
from checkpoint_io import recover_checkpoint, save_checkpoint
from position_bank import PositionBank
from prepared import PreparedObservations
from critic import fit_critic
from learning import STYLES, training_samples, value_diagnostics, learner_sample_counts, parameter_groups, make_optimizers, restore_optimizers


def terminal_samples(results):
    return training_samples(results)


def decision_type(observation):
    if observation.get('wire'):
        return observation.get('decision_type', 'unknown')
    return observation['entities'][observation['question']]['categorical']['type']


def decision_group(observation):
    if observation.get('wire'):
        stage = observation.get('decision_stage', 'complete')
        skill = observation.get('decision_skill')
    else:
        question = observation['entities'][observation['question']]['categorical']
        stage = question.get('stage', 'complete')
        skill = question.get('skill')
    return '/'.join((decision_type(observation), stage, skill or 'none'))


def check_revision(checkpoint, revision, label):
    recorded = checkpoint.get('revision', 'development')
    if revision != 'development' and recorded not in ('development', revision):
        raise ValueError(f'{label} rules revision {recorded!r} differs from requested {revision!r}')


def update(model, vocabulary, optimizer, rows, *, batch_size, epochs, device, target_kl=None, normalize_advantage=False, entropy_weight=0.01, critic_mode="legacy", critic_updates=32, critic_loss="bce", reference_rows=None, reference_weight=0., rehearsal=None, rehearsal_weight=0.):
    if not rows: raise ValueError('No completed trajectories; truncated games are not losses')
    if not 0 <= reference_weight <= 0.1 or (reference_weight and not reference_rows):
        raise ValueError('Human reference must have data and bounded weight')
    if not 0 <= rehearsal_weight <= 5 or (rehearsal_weight and rehearsal is None):
        raise ValueError('Rehearsal requires a saved policy bank and bounded weight')
    if batch_size < 1 or epochs < 1: raise ValueError('Batch size and epochs must be positive')
    if target_kl is not None and not 0 < target_kl < float('inf'):
        raise ValueError('Target KL must be finite and positive')
    started = time.perf_counter()
    model.train()
    metric_names = ('policy_loss', 'value_loss', 'entropy', 'approx_kl', 'clip_fraction', 'normalized_entropy')
    independent = isinstance(optimizer, dict)
    groups = parameter_groups(model)
    grouped_critic = critic_mode == "grouped"
    if grouped_critic and not independent:
        raise ValueError("Grouped critic requires independent optimizers")
    actor_stopped = False
    advantages = torch.tensor([row['advantage'] for row in rows])
    advantage_mean = float(advantages.mean()) if normalize_advantage else 0.
    advantage_scale = max(float(advantages.std(unbiased=False)), 1e-8) if normalize_advantage else 1.
    stats = dict(updates=0, samples=len(rows), sample_visits=0, stopped_early=False,
                 target_kl=target_kl, stopping_kl=None, actor_updates=0, critic_updates=0,
                 independent_updates=independent, by_decision_type={}, by_decision_group={})
    totals = dict.fromkeys(metric_names, 0.)
    for row in rows:
        observation = row['observation']
        for key, kind in (('by_decision_type', decision_type(observation)),
                          ('by_decision_group', decision_group(observation))):
            group = stats[key].setdefault(kind,
                dict(samples=0, sample_visits=0, **dict.fromkeys(metric_names, 0.)))
            group['samples'] += 1
    prepared = PreparedObservations([row['observation'] for row in rows], vocabulary)
    reference = PreparedObservations([r['observation'] for r in reference_rows], vocabulary) if reference_weight else None
    reference_groups = {}
    for row in reference_rows or []:
        reference_groups.setdefault((row['gameId'], row['sequence']), []).append(row)
    reference_groups = list(reference_groups.values())
    stats.update(reference_weight=reference_weight, reference_visits=0, reference_loss_sum=0.)
    stats.update(rehearsal_weight=rehearsal_weight, rehearsal_batches=0, rehearsal_kl_sum=0.)
    stats['prepare_seconds'] = time.perf_counter()-started
    for _ in range(epochs):
        random.shuffle(rows)
        for start in range(0, len(rows), batch_size):
            selected = rows[start:start+batch_size]
            batch = prepared.collate([row['observation'] for row in selected], device)
            if grouped_critic:
                logits = model.policy_logits(batch)
                values = torch.tensor([r["old_value"] for r in selected], device=device)
            else:
                logits, values = model(batch)
            temperatures = torch.tensor([r.get('policy_temperature', 1.) for r in selected], device=device)
            if not torch.isfinite(temperatures).all() or (temperatures <= 0).any():
                raise ValueError('Invalid rollout policy temperature')
            distribution = torch.distributions.Categorical(logits=logits / temperatures.unsqueeze(1))
            tensor = lambda data, dtype=torch.float32: torch.tensor(data, dtype=dtype, device=device)
            log_prob = distribution.log_prob(tensor([r['choice'] for r in selected], torch.long))
            log_ratio = log_prob-tensor([r['old_log_prob'] for r in selected])
            ratio = log_ratio.exp()
            advantage = (tensor([r['advantage'] for r in selected])-advantage_mean)/advantage_scale
            policy_loss = -torch.minimum(ratio*advantage, ratio.clamp(0.8, 1.2)*advantage)
            value_loss = (values-tensor([r['return'] for r in selected])).square()
            entropy = distribution.entropy()
            approx_kl = (ratio - 1 - log_ratio).clamp_min(0)
            clip_fraction = ((ratio - 1).abs() > 0.2).float()
            candidate_counts = (~batch['mask'][:, batch['entities']:]).sum(-1)
            normalized_entropy = torch.where(candidate_counts > 1,
                entropy/candidate_counts.float().clamp_min(2).log(), torch.zeros_like(entropy))
            actor_loss = (policy_loss-entropy_weight*entropy).mean()
            if rehearsal_weight:
                rehearsal_loss = rehearsal.loss(model, device)
                actor_loss = actor_loss + rehearsal_weight * rehearsal_loss
                stats['rehearsal_batches'] += 1
                stats['rehearsal_kl_sum'] += float(rehearsal_loss.detach())
            if reference is not None:
                # One fallible reference per root decision, not per generated
                # substep. No demonstration enters returns or critic fitting.
                examples = [random.choice(random.choice(reference_groups)) for _ in range(min(16, batch_size))]
                reference_logits = model.policy_logits(reference.collate([r['observation'] for r in examples], device))
                reference_loss = torch.nn.functional.cross_entropy(reference_logits,
                    tensor([r['choice'] for r in examples], torch.long))
                actor_loss = actor_loss + reference_weight * reference_loss
                stats['reference_visits'] += len(examples)
                stats['reference_loss_sum'] += float(reference_loss.detach()) * len(examples)
            value_objective = value_loss.mean()
            loss = actor_loss if grouped_critic else actor_loss + (value_objective if independent else 0.5*value_objective)
            if not torch.isfinite(loss): raise RuntimeError('Nonfinite PPO loss')
            # This is a sampled KL estimate against the rollout policy, observed
            # before this minibatch update. It is not a full-distribution bound.
            measured_kl = float(approx_kl.detach().mean())
            if target_kl is not None and measured_kl > target_kl:
                stats['stopped_early'] = True
                stats['stopping_kl'] = measured_kl
                actor_stopped = True
                if not independent or grouped_critic:
                    break
            if independent:
                for current in optimizer.values():
                    current.zero_grad(set_to_none=True)
                (value_objective if actor_stopped else loss).backward()
                for key in ('actor', 'critic'):
                    if (key == 'actor' and actor_stopped) or (key == 'critic' and grouped_critic):
                        continue
                    torch.nn.utils.clip_grad_norm_(groups[key], 1)
                    optimizer[key].step()
                    stats[key+'_updates'] += 1
            else:
                optimizer.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1)
                optimizer.step()
                stats['actor_updates'] += 1
                stats['critic_updates'] += 1
            stats['updates'] += 1
            stats['sample_visits'] += len(selected)
            readings = torch.stack((policy_loss, value_loss, entropy, approx_kl, clip_fraction, normalized_entropy), dim=1).detach().cpu().tolist()
            for row, reading in zip(selected, readings):
                for name, value in zip(metric_names, reading):
                    totals[name] += value
                observation = row['observation']
                for key, kind in (('by_decision_type', decision_type(observation)),
                                  ('by_decision_group', decision_group(observation))):
                    group = stats[key][kind]
                    group['sample_visits'] += 1
                    for name, value in zip(metric_names, reading):
                        group[name] += value
        if stats['stopped_early'] and (not independent or grouped_critic):
            break
    for name in metric_names:
        stats[name] = totals[name] / max(1, stats['sample_visits'])
    for key in ('by_decision_type', 'by_decision_group'):
        for group in stats[key].values():
            group['sample_fraction'] = group['samples'] / len(rows)
            for name in metric_names:
                group[name] /= max(1, group['sample_visits'])
    if grouped_critic:
        stats['critic'] = fit_critic(model, vocabulary, optimizer['critic'], rows,
            batch_size=batch_size, device=device, max_updates=critic_updates, loss=critic_loss)
        stats['critic_updates'] = stats['critic']['updates']
        stats['value_metric'] = 'Actor-loop value errors are frozen rollout predictions; critic validation is reported separately'
    stats['seconds'] = time.perf_counter()-started
    return stats


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('checkpoint'); parser.add_argument('output')
    parser.add_argument('--rounds', type=int, default=1, help='Additional collection/update rounds')
    parser.add_argument('--games', type=int); parser.add_argument('--workers', type=int, default=16)
    parser.add_argument('--batch', type=int); parser.add_argument('--epochs', type=int)
    parser.add_argument('--target-kl', type=float, help='Stop round updates when sampled rollout-policy KL exceeds this value')
    parser.add_argument('--seed', type=int)
    parser.add_argument('--device', default='cpu')
    parser.add_argument('--opponents', nargs='+', help='Rule policy versions or self, rotated by round')
    parser.add_argument('--league', action='store_true')
    parser.add_argument('--positions')
    parser.add_argument('--history')
    parser.add_argument('--anchor', help='Frozen 417 actor migrated to this schema')
    parser.add_argument('--league-profile', choices=['classic','diverse-v1'], default='classic')
    parser.add_argument('--revision', default='development')
    parser.add_argument('--experiment', help='Explicitly fork learning settings, preserving weights and optimizer moments')
    parser.add_argument('--independent-updates', action='store_true', default=None)
    parser.add_argument('--learning-signal', choices=['mc', 'gae'])
    parser.add_argument('--trace-lambda', type=float)
    parser.add_argument('--morale-weight', type=float)
    parser.add_argument('--style', choices=STYLES)
    parser.add_argument('--style-weight', type=float)
    parser.add_argument('--actor-lr', type=float)
    parser.add_argument('--critic-lr', type=float)
    parser.add_argument('--entropy-weight', type=float)
    parser.add_argument('--opponent-temperature', type=float)
    parser.add_argument('--normalize-advantage', action='store_true', default=None)
    parser.add_argument('--curriculum', choices=['scheduled', 'endgame'])
    parser.add_argument('--critic-mode', choices=['legacy', 'grouped'])
    parser.add_argument('--critic-updates', type=int)
    parser.add_argument('--critic-loss', choices=['mse', 'bce'])
    args = parser.parse_args()
    if args.rounds == 1 and recover_checkpoint(args.output): parser.error('Output exists')
    if args.rounds < 1 or args.workers < 1: parser.error('rounds and workers must be positive')
    torch.set_num_threads(2)
    checkpoint = torch.load(args.checkpoint, map_location='cpu', weights_only=False)
    check_revision(checkpoint, args.revision, 'Training checkpoint')
    rule_variant = os.environ.get('XINGBEI_TRAINING_RULE_VARIANT', 'standard')
    if checkpoint.get('rule_variant', 'standard') != rule_variant:
        raise ValueError('Training rule variant differs from checkpoint; prepare an explicit experiment fork')
    previous = checkpoint.get('rl')
    defaults = dict(target_kl=None, independent_updates=False, learning_signal='mc', trace_lambda=0.95,
                    morale_weight=0., actor_lr=1e-4, critic_lr=1e-4, entropy_weight=0.01,
                    style='win', style_weight=0.,
                    normalize_advantage=False, curriculum='scheduled', opponent_temperature=0.0,
                    critic_mode='legacy', critic_updates=32, critic_loss='bce')
    previous_config = {**defaults, **previous['config']} if previous else None
    target_kl = args.target_kl
    if target_kl is None and previous_config:
        target_kl = previous_config['target_kl']
    config = dict(games=args.games or (previous['config']['games'] if previous else 6),
                  batch=args.batch or (previous['config']['batch'] if previous else 32),
                  epochs=args.epochs or (previous['config']['epochs'] if previous else 2),
                  opponents=args.opponents or (previous['config']['opponents'] if previous else [catalog()['ruleTeacher'], 'self']),
                  seed=args.seed if args.seed is not None else (previous['config']['seed'] if previous else 211102700),
                  target_kl=target_kl)
    for key, default in defaults.items():
        supplied = getattr(args, key)
        inherited = previous_config or {**defaults, 'independent_updates': True}
        config[key] = supplied if supplied is not None else inherited[key]
    if min(config['games'], config['batch'], config['epochs']) < 1: parser.error('games, batch and epochs must be positive')
    if config['target_kl'] is not None and not 0 < config['target_kl'] < float('inf'):
        parser.error('target-kl must be finite and positive')
    if previous and config != previous_config and not args.experiment:
        raise ValueError('Resume settings differ; use --experiment to explicitly fork')
    if not 0 <= config['trace_lambda'] <= 1 or not 0 <= config['morale_weight'] <= 1:
        parser.error('lambda and morale-weight must be in [0,1]')
    if not 0 <= config['style_weight'] <= 1 or (config['style'] == 'win' and config['style_weight']):
        parser.error('style-weight must be in [0,1], and zero for win-only training')
    if config['morale_weight'] + config['style_weight'] > 1:
        parser.error('Combined auxiliary reward range exceeds supported value scale')
    if any(not 0 < config[key] < float('inf') for key in ('actor_lr', 'critic_lr')):
        parser.error('learning rates must be finite and positive')
    if not 0 <= config['entropy_weight'] < float('inf'):
        parser.error('entropy-weight must be finite and nonnegative')
    if not 0 <= config['opponent_temperature'] < float('inf'):
        parser.error('opponent-temperature must be finite and nonnegative')
    if config['critic_updates'] < 1 or (config['critic_mode'] == 'grouped' and not config['independent_updates']):
        parser.error('Grouped critic requires independent updates and a positive update budget')
    if config['critic_mode'] == 'grouped' and config['critic_loss'] == 'bce' and (config['learning_signal'] != 'mc' or config['morale_weight'] or config['style'] != 'win'):
        parser.error('Binary critic loss requires unshaped terminal MC targets')
    random.seed(config['seed']); torch.manual_seed(config['seed'])
    restore_rng = previous and not (args.experiment and args.seed is not None)
    model, vocabulary = EntityPolicy.restore(checkpoint); model.to(args.device)
    if config['critic_mode'] == 'grouped' and config['critic_loss'] == 'bce' and model.value_scale != 1:
        raise ValueError('Binary critic loss requires a checkpoint with value_scale=1')
    required_value_scale = 1 + config['morale_weight'] + config['style_weight']
    if model.value_scale < required_value_scale:
        if previous and not args.experiment:
            raise ValueError('Shaped value range requires an explicit experiment')
        model.value_scale = required_value_scale
        model.config['value_scale'] = model.value_scale
    optimizer = (make_optimizers(model, config['actor_lr'], config['critic_lr']) if config['independent_updates']
                 else torch.optim.AdamW(model.parameters(), lr=config['actor_lr']))
    if previous:
        if config['independent_updates']:
            restore_optimizers(optimizer, checkpoint['optimizer'], model)
        else:
            optimizer.load_state_dict(checkpoint['optimizer'])
        if args.experiment:
            for key, current in (optimizer.items() if isinstance(optimizer, dict) else [('actor', optimizer)]):
                for group in current.param_groups:
                    group['lr'] = config[key+'_lr']
        if restore_rng:
            random.setstate(checkpoint['random_state']); torch.set_rng_state(checkpoint['torch_rng'])
            if args.device == 'cuda' and checkpoint['cuda_rng']: torch.cuda.set_rng_state_all(checkpoint['cuda_rng'])
    rounds = previous['rounds'] if previous else 0
    for round_index in range(rounds, rounds+args.rounds):
        destination = args.output if args.rounds == 1 else f'{args.output}.round-{round_index+1}.pt'
        if recover_checkpoint(destination):
            raise ValueError(f'Output exists: {destination}')
    reports = []
    positions = PositionBank(args.positions) if args.positions else []
    completed = checkpoint.get('completed_games',0)
    hero_coverage = checkpoint.get('hero_coverage',{})
    models = {}
    if args.history:
        history = torch.load(args.history,map_location='cpu',weights_only=False)
        check_revision(history, args.revision, 'Historical opponent')
        models['history'] = EntityPolicy.restore(history)
    if args.anchor:
        anchor = torch.load(args.anchor,map_location='cpu',weights_only=False)
        check_revision(anchor,args.revision,'Frozen anchor')
        models['anchor417'] = EntityPolicy.restore(anchor)
    if restore_rng:
        torch.set_rng_state(checkpoint['torch_rng'])
        if args.device == 'cuda' and checkpoint['cuda_rng']: torch.cuda.set_rng_state_all(checkpoint['cuda_rng'])
    else:
        # Model construction must not consume the experiment's sampling stream.
        random.seed(config['seed']); torch.manual_seed(config['seed'])
    excluded = set(checkpoint.get('validation_seeds', []))
    for round_index in range(rounds, rounds+args.rounds):
        opponent = config['opponents'][round_index % len(config['opponents'])]
        configs = [dict(seed=config['seed']+round_index*config['games']+i,
                        heroIds=roster(round_index*config['games']+i), start=i % 6) for i in range(config['games'])]
        curriculum = None
        if args.league:
            configs,curriculum=training_configs(index=round_index*config['games'],count=config['games'],completed=completed,
                revision=args.revision,positions=positions,excluded=excluded,historical='model:history' if 'history' in models else None, curriculum=config['curriculum'],
                league_profile=args.league_profile, anchor='model:anchor417' if 'anchor417' in models else None)
        rollout = asyncio.run(run_games(model, vocabulary, configs, workers=args.workers, device=args.device,
                                       opponent=None if opponent == 'self' else opponent, trajectory=True,models=models,binary=True,
                                       opponent_temperature=config['opponent_temperature']))
        for game in rollout['results']:
            for hero in game['heroIds']: hero_coverage[hero] = hero_coverage.get(hero,0)+1
        rows = training_samples(rollout['results'], method=config['learning_signal'],
                                trace_lambda=config['trace_lambda'], morale_weight=config['morale_weight'],
                                style=config['style'], style_weight=config['style_weight'])
        metrics = update(model, vocabulary, optimizer, rows, batch_size=config['batch'], epochs=config['epochs'], device=args.device,
                         target_kl=config['target_kl'], normalize_advantage=config['normalize_advantage'],
                         entropy_weight=config['entropy_weight'], critic_mode=config['critic_mode'],
                         critic_updates=config['critic_updates'], critic_loss=config['critic_loss'])
        metrics['rollout_value_by_phase'] = value_diagnostics(rows)
        metrics['learner_samples_by_opponent'] = learner_sample_counts(rows)
        metrics['reward_style'] = config['style']
        # One value per learning seat, so long trajectories do not inflate the
        # reported preference bonus. Only finished games enter this summary.
        bonuses = {(row['game_id'], row['seat']): row['style_bonus'] for row in rows}
        metrics['style_bonus'] = dict(seats=len(bonuses),
            mean=sum(bonuses.values()) / max(1, len(bonuses)),
            minimum=min(bonuses.values(), default=0.), maximum=max(bonuses.values(), default=0.))
        completed += sum(r['terminated'] for r in rollout['results'])
        report = dict(league_profile=args.league_profile, anchor=args.anchor, rule_variant=rule_variant, learning=config, architecture=model.config,
                      hero_coverage=hero_coverage, curriculum=curriculum, completed_total=completed, round=round_index+1, opponent='league-mix' if args.league else opponent, opponent_counts={key:sum(c.get('opponent',opponent)==key for c in configs) for key in sorted({c.get('opponent',opponent) for c in configs})}, decisions=len(rows),
                      completed=sum(r['terminated'] for r in rollout['results']),
                      inability_forfeits=sum(len(r.get('inabilityForfeits', [])) for r in rollout['results']),
                      truncated=sum(r['truncated'] for r in rollout['results']), rollout=rollout['stats'], update=metrics,
                      games=[{k:v for k,v in result.items() if k != 'trajectory'} for result in rollout['results']])
        reports.append(report)
        # Every completed round is a recovery point. Multiple rounds get separate
        # files; never overwrite a previous checkpoint or the deployed service.
        destination = args.output if args.rounds == 1 else f'{args.output}.round-{round_index+1}.pt'
        saved = model.checkpoint(vocabulary)
        saved.update(rule_variant=rule_variant, lineage=checkpoint.get('lineage'), league_profile=args.league_profile, anchor=args.anchor)
        saved.update(hero_coverage=hero_coverage, completed_games=completed, revision=args.revision, validation_seeds=list(excluded), curriculum=curriculum, historical_checkpoint=args.history, rl=dict(rounds=round_index+1, config=config), optimizer={key:opt.state_dict() for key,opt in optimizer.items()} if isinstance(optimizer,dict) else optimizer.state_dict(),
                     random_state=random.getstate(), torch_rng=torch.get_rng_state(),
                     cuda_rng=torch.cuda.get_rng_state_all() if torch.cuda.is_available() else [],
                     parent_checkpoint=args.checkpoint, experiment=args.experiment or checkpoint.get('experiment'))
        save_checkpoint(destination, saved, report)
        print(json.dumps({k:v for k,v in report.items() if k != 'games'}), flush=True)
    return reports


if __name__ == '__main__': main()
