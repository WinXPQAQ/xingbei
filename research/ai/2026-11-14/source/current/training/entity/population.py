"""Sequential style discovery and paired win-only league experiments."""
import argparse
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import random
import subprocess
import sys
import tempfile
import time
import traceback

from checkpoint_io import recover_checkpoint
from league import catalog, history_pool
from position_bank import PositionBank
from telemetry import Telemetry

ROOT = Path(__file__).resolve().parents[2]
STYLES = ('attack', 'cups', 'support')
ARMS = ('control', 'population')


class PauseRequested(Exception):
    pass


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, prefix=path.name + '.',
                                     suffix='.pending', delete=False) as output:
        pending = Path(output.name)
        json.dump(value, output, ensure_ascii=False, indent=2)
        output.flush()
        os.fsync(output.fileno())
    pending.replace(path)


def next_branch(state):
    branches = state['branches']
    unfinished = [name for name in STYLES
                  if branches[name]['rounds'] < state['configuration']['style_rounds']]
    names = unfinished or ARMS
    return min(names, key=lambda name: (branches[name]['rounds'], names.index(name)))


def historical_opponent(state, name):
    branch = state['branches'][name]
    round_index = branch['rounds']
    if name == 'population' and round_index % 2 == 0:
        style = STYLES[(round_index // 2) % len(STYLES)]
        return state['branches'][style]['latest'], f'style:{style}'
    choices = history_pool([state['baseline']] + branch['history'][:-1])
    return choices[round_index % len(choices)], 'history'


def paired_difference(first, second):
    """Cluster both mirrored games by seed; compare the same evaluation games."""
    by_seed = []
    left, right = first['results'], second['results']
    if not left or len(left) != len(right) or len(left) % 2:
        raise ValueError('Paired evaluation lengths differ')
    for index in range(0, len(left), 2):
        delta = 0
        for offset in (0, 1):
            a, b = left[index + offset], right[index + offset]
            if (a['seed'], a['heroIds'], a.get('start')) != (b['seed'], b['heroIds'], b.get('start')):
                raise ValueError('Paired evaluation configurations differ')
            if not a['terminated'] or not b['terminated']:
                raise ValueError('Cannot compare truncated evaluation games')
            side = 'red' if offset == 0 else 'blue'
            delta += int(a['winner'] == side) - int(b['winner'] == side)
        by_seed.append(delta / 2)
    rng = random.Random(731110017)
    samples = sorted(sum(rng.choices(by_seed, k=len(by_seed))) / len(by_seed)
                     for _ in range(2000))
    return dict(win_rate_difference=sum(by_seed) / len(by_seed),
                paired_seed_interval95=[samples[49], samples[1949]], pairs=len(by_seed))


def behavior_summary(results):
    """Public behavior per controlled-team turn, within one fixed opponent set."""
    totals = dict(attackAttempts=0, attackHits=0, attackDamage=0, spellDamage=0,
                  healingFlow=0, healingSpent=0, holyLightBlocks=0, cupsGain=0,
                  ownMoraleChange=0, enemyMoraleLost=0)
    games = turns = 0
    for index, result in enumerate(results):
        behavior = result.get('publicBehavior', {})
        if behavior.get('schema') != 'team-behavior-v1':
            continue
        side = 'red' if index % 2 == 0 else 'blue'
        own = behavior['teams'][side]
        enemy = behavior['teams']['blue' if side == 'red' else 'red']
        games += 1
        turns += own['turns']
        for key in ('attackAttempts', 'attackHits', 'attackDamage', 'spellDamage',
                    'healingSpent', 'holyLightBlocks'):
            totals[key] += own[key]
        # Net healing plus healing spent on prevention is a public flow proxy;
        # other healing removals are retained in the net change.
        totals['healingFlow'] += own['end']['healing'] - own['start']['healing'] + own['healingSpent']
        totals['cupsGain'] += own['end']['cups'] - own['start']['cups']
        totals['ownMoraleChange'] += own['end']['morale'] - own['start']['morale']
        totals['enemyMoraleLost'] += enemy['start']['morale'] - enemy['end']['morale']
    return dict(games=games, missingGames=len(results) - games, teamTurns=turns,
                perTeamTurn={key: value / turns if turns else None for key, value in totals.items()},
                attackHitRate=totals['attackHits'] / totals['attackAttempts'] if totals['attackAttempts'] else None)


def report(directory):
    state = json.loads((directory / 'status.json').read_text())
    samples = []
    gpu = directory / 'gpu.log'
    if gpu.exists():
        cutoff = time.time() - 3600
        for line in gpu.read_text().splitlines()[-4000:]:
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if row['time'] >= cutoff:
                samples.append(row['processes'])
    utilization = [sum(process['sm'] for process in row) for row in samples]
    summary = dict(generated_at=datetime.now(timezone.utc).isoformat(), status=state,
                   gpu=dict(samples=len(samples),
                            mean_sm=sum(utilization) / len(utilization) if utilization else None,
                            peak_memory_mib=max((sum(process['memory'] for process in row)
                                                 for row in samples), default=0)))
    write_json(directory / 'latest-report.json', summary)
    write_json(directory / 'hourly' / (datetime.now(timezone.utc).strftime('%Y%m%d-%H') + '.json'), summary)
    lines = [f"状态 {state['status']}", f"阶段 {state['stage']}",
             f"GPU {summary['gpu']}", f"规则版本 {state['revision']}"]
    for name, branch in state['branches'].items():
        lines.append(f"{name} 已完成{branch['rounds']}轮、{branch['completed_games']}局，检查点 {branch['latest']}")
        metrics = branch.get('metrics')
        if metrics:
            lines.append(f"  开发评测 {metrics}")
        if branch.get('behaviorSummary'):
            lines.append(f"  固定对手行为／己方回合 {branch['behaviorSummary']}")
        update = branch.get('last_update', {})
        if update.get('learner_samples_by_opponent'):
            lines.append(f"  实际学习样本 {update['learner_samples_by_opponent']}")
        if update.get('style_bonus'):
            lines.append(f"  人格奖励 {update['style_bonus']}")
    if state.get('comparison'):
        lines.append(f"同轮配对比较 {state['comparison']}")
    if state.get('error'):
        lines.append(f"异常已停训 {state['error']}")
    (directory / 'latest-report.txt').write_text('\n'.join(lines) + '\n')
    return summary


def run(args):
    directory = args.directory.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / 'lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return run_locked(args, directory)


def run_locked(args, directory):
    config = {key: getattr(args, key) for key in (
        'workers', 'batch', 'round_games', 'style_rounds', 'style_weight',
        'evaluate_every', 'pairs', 'evaluation_seed_base', 'seed', 'device')}
    status_path = directory / 'status.json'
    baseline = str(args.checkpoint.resolve())
    if not Path(baseline).is_file():
        raise FileNotFoundError(baseline)
    if status_path.exists():
        state = json.loads(status_path.read_text())
        if (state['revision'], state['baseline'], state['configuration']) != (args.revision, baseline, config):
            raise ValueError('Population resume configuration differs')
        if state['status'] == 'error':
            raise RuntimeError('Saved rule/interface error requires explicit resolution before resume')
    else:
        state = dict(status='ready', stage='styles', revision=args.revision, baseline=baseline,
                     configuration=config, last_report=0, last_evaluation=0,
                     training_seed_protocol='league source seeds 831103000 + inherited round * games; evaluation disjoint',
                     branches={name: dict(rounds=0, completed_games=0, latest=baseline,
                                          history=[], history_usage={}) for name in (*STYLES, *ARMS)})

    def save(**changes):
        state.update(changes, updated_at=datetime.now(timezone.utc).isoformat())
        write_json(status_path, state)

    diagnostics = directory / 'rule-failures'
    diagnostics.mkdir(exist_ok=True)
    os.environ['XINGBEI_DIAGNOSTIC_DIR'] = str(diagnostics)
    os.environ['XINGBEI_SOURCE_REVISION'] = args.revision

    def command_run(command, label):
        log_path = directory / 'progress.log'
        diagnostic_path = diagnostics / label
        diagnostic_path.mkdir(exist_ok=True)
        os.environ['XINGBEI_DIAGNOSTIC_DIR'] = str(diagnostic_path)
        while True:
            if (directory / 'PAUSE').exists():
                raise PauseRequested()
            if config['device'] == 'cuda':
                free = int(subprocess.check_output(
                    ['nvidia-smi', '--query-gpu=memory.free', '--format=csv,noheader,nounits'],
                    text=True).splitlines()[0])
                if free < 1800:
                    save(status='waiting_for_gpu')
                    report(directory)
                    time.sleep(60)
                    continue
            save(status='running', command=command, diagnostic_directory=str(diagnostic_path), resource_error=None)
            with log_path.open('a', buffering=1) as log:
                log.write(f'\n{datetime.now(timezone.utc).isoformat()} {command!r}\n')
                offset = log.tell()
                result = subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
            if result.returncode == 0:
                return
            with log_path.open('rb') as log:
                log.seek(max(offset, log_path.stat().st_size - 32768))
                failure = log.read().decode('utf-8', errors='replace')
            cuda_oom = any(line.startswith(('torch.OutOfMemoryError: CUDA out of memory',
                                           'torch.cuda.OutOfMemoryError: CUDA out of memory'))
                           for line in failure.splitlines())
            if not cuda_oom:
                raise RuntimeError(f'Subprocess failed with code {result.returncode}\n{failure[-8000:]}')
            save(status='waiting_for_gpu', resource_error=failure[-4000:])
            report(directory)
            time.sleep(60)

    def evaluate_branch(name, checkpoint, rounds):
        output = directory / 'evaluations' / f'{name}-{rounds:06d}.json'
        if not output.exists():
            command_run([sys.executable, 'training/entity/evaluate-all.py', checkpoint, baseline,
                         str(output), '--revision', args.revision, '--pairs', str(config['pairs']),
                         '--workers', str(config['workers']), '--seed-base', str(config['evaluation_seed_base']),
                         '--opponents', 'rule', 'best', '--temperature', '0'],
                        f'eval-{name}-{rounds:06d}')
        evaluation = json.loads(output.read_text())
        if any(values['truncated'] for values in evaluation['opponents'].values()):
            raise RuntimeError(f'Population evaluation truncated; preserve {output} and inspect before resuming')
        metrics = {opponent: {key: values[key] for key in
                   ('games', 'wins', 'win_rate', 'paired_seed_interval95', 'truncated')}
                   for opponent, values in evaluation['opponents'].items()}
        behavior = {opponent: behavior_summary(values.get('results', []))
                    for opponent, values in evaluation['opponents'].items()}
        if name == 'baseline':
            state['baseline_evaluation'] = str(output)
            state['baselineBehaviorSummary'] = behavior
        else:
            branch = state['branches'][name]
            branch.update(evaluation=str(output), evaluated_round=rounds, metrics=metrics,
                          behaviorSummary=behavior)
            score = metrics[catalog()['ruleTeacher']]['win_rate']
            if score > branch.get('best_score', -1):
                branch.update(best=checkpoint, best_score=score)
        save()
        return evaluation

    save()
    with Telemetry(directory):
        try:
            while not (directory / 'PAUSE').exists():
                if not state.get('baseline_evaluation'):
                    evaluate_branch('baseline', baseline, 0)
                name = next_branch(state)
                if name in ARMS and state['stage'] == 'styles':
                    for style in STYLES:
                        branch = state['branches'][style]
                        if branch.get('evaluated_round') != branch['rounds']:
                            evaluate_branch(style, branch['latest'], branch['rounds'])
                    save(stage='comparison', frozen_styles={style: state['branches'][style]['latest']
                                                          for style in STYLES})
                branch = state['branches'][name]
                round_number = branch['rounds'] + 1
                destination = directory / name / f'round-{round_number:06d}.pt'
                positions = directory / name / 'positions.jsonl'
                positions.parent.mkdir(parents=True, exist_ok=True)
                positions.touch(exist_ok=True)
                history, history_kind = historical_opponent(state, name)
                command = [sys.executable, 'training/entity/reinforce.py', branch['latest'], str(destination),
                           '--league', '--positions', str(positions), '--revision', args.revision,
                           '--games', str(config['round_games']), '--workers', str(config['workers']),
                           '--batch', str(config['batch']), '--epochs', '2', '--device', config['device'],
                           '--history', history]
                if not branch['rounds']:
                    style = name if name in STYLES else 'win'
                    command += ['--experiment', f'population-v1-{name}', '--style', style,
                                '--style-weight', str(config['style_weight'] if name in STYLES else 0),
                                '--curriculum', 'scheduled', '--morale-weight', '0',
                                '--learning-signal', 'mc', '--critic-loss', 'mse' if name in STYLES else 'bce',
                                '--seed', str(config['seed'])]
                save(active_branch=name, active_round=round_number, history_opponent=history,
                     history_kind=history_kind)
                if not recover_checkpoint(destination):
                    command_run(command, f'{name}-{round_number:06d}')
                result = json.loads(Path(str(destination) + '.json').read_text())
                PositionBank(positions).merge(result['games'])
                branch.update(rounds=round_number, latest=str(destination),
                              completed_games=branch['completed_games'] + result['completed'],
                              learning=result.get('learning'),
                              last_rollout=result['rollout'], last_update={key: result['update'].get(key) for key in
                              ('samples', 'actor_updates', 'critic_updates', 'normalized_entropy',
                               'learner_samples_by_opponent', 'reward_style', 'style_bonus')},
                              curriculum=result.get('curriculum'))
                branch['history'].append(str(destination))
                branch['history_usage'][history_kind] = branch['history_usage'].get(history_kind, 0) + 1
                save(status='ready')
                arms = [state['branches'][arm] for arm in ARMS]
                paired_round = arms[0]['rounds']
                due = (paired_round > 0 and paired_round == arms[1]['rounds']
                       and (paired_round % config['evaluate_every'] == 0
                            or time.time() - state['last_evaluation'] >= 3600))
                if due:
                    evaluations = [evaluate_branch(arm, state['branches'][arm]['latest'], paired_round)
                                   for arm in ARMS]
                    comparison = {opponent: paired_difference(evaluations[1]['opponents'][opponent],
                                                              evaluations[0]['opponents'][opponent])
                                  for opponent in evaluations[0]['opponents']}
                    save(comparison=dict(round=paired_round, population_minus_control=comparison),
                         last_evaluation=time.time())
                if time.time() - state['last_report'] >= 3600 or due:
                    save(last_report=time.time())
                    report(directory)
                if args.once:
                    save(status='ready')
                    return
            save(status='paused')
        except PauseRequested:
            save(status='paused')
        except Exception:
            save(status='error', error=traceback.format_exc())
            raise
        finally:
            report(directory)


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest='command', required=True)
    train = commands.add_parser('run')
    train.add_argument('directory', type=Path)
    train.add_argument('checkpoint', type=Path)
    train.add_argument('--revision', required=True)
    train.add_argument('--workers', type=int, default=64)
    train.add_argument('--batch', type=int, default=64)
    train.add_argument('--round-games', type=int, default=192)
    train.add_argument('--style-rounds', type=int, default=12)
    train.add_argument('--style-weight', type=float, default=.3)
    train.add_argument('--evaluate-every', type=int, default=20)
    train.add_argument('--pairs', type=int, default=144)
    train.add_argument('--evaluation-seed-base', type=int, default=951111000)
    train.add_argument('--seed', type=int, default=1051100000)
    train.add_argument('--device', choices=['cpu', 'cuda'], default='cuda')
    train.add_argument('--once', action='store_true')
    reporting = commands.add_parser('report')
    reporting.add_argument('directory', type=Path)
    args = parser.parse_args()
    for key in ('workers', 'batch', 'round_games', 'style_rounds', 'evaluate_every', 'pairs'):
        if hasattr(args, key) and getattr(args, key) < 1:
            parser.error(f'{key} must be positive')
    if args.command == 'run':
        if not 0 < args.style_weight <= 1:
            parser.error('style-weight must be in (0,1]')
        run(args)
    else:
        report(args.directory.resolve())


if __name__ == '__main__':
    main()
