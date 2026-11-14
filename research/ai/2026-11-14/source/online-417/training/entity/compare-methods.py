"""Paired learning-method experiments from one frozen checkpoint and replay bank.

Prepare without starting games via --prepare-only. Every round is resumable;
a rule/interface failure stops the comparison and retains the failing command.
"""
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sqlite3
import sys
import time
import torch
from checkpoint_io import recover_checkpoint
from reinforce import check_revision
from position_bank import PositionBank

ROOT = Path(__file__).resolve().parents[2]


class TrainingWait(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('checkpoint', type=Path)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--positions', type=Path, required=True)
    parser.add_argument('--history', type=Path, required=True)
    parser.add_argument('--rounds', type=int, default=10)
    parser.add_argument('--seeds', type=int, nargs='+', default=[17, 29])
    parser.add_argument('--games', type=int, default=192)
    parser.add_argument('--workers', type=int, default=64)
    parser.add_argument('--batch', type=int, default=64)
    parser.add_argument('--pairs', type=int, default=144)
    parser.add_argument('--control', type=Path,
        default=Path.home()/'.local/share/xingbei-ml/training-control.json')
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args()
    if min(args.rounds, args.games, args.workers, args.batch, args.pairs) < 1:
        parser.error('Experiment sizes must be positive')
    if len(set(args.seeds)) != len(args.seeds):
        parser.error('Sampling seeds must be distinct')
    checkpoint = torch.load(args.checkpoint, map_location='cpu', weights_only=False)
    check_revision(checkpoint, args.revision, 'Comparison baseline')
    history = torch.load(args.history, map_location='cpu', weights_only=False)
    check_revision(history, args.revision, 'Frozen historical opponent')
    configuration = checkpoint.get('rl', {}).get('config', {})
    if configuration.get('morale_weight', 0) or configuration.get('learning_signal', 'mc') != 'mc':
        parser.error('This ablation starts from an unshaped MC baseline')
    arms = dict(independent_mc=['--independent-updates', '--learning-signal', 'mc'],
                gae=['--independent-updates', '--learning-signal', 'gae'],
                gae_morale=['--independent-updates', '--learning-signal', 'gae', '--morale-weight', '0.2'])
    if not configuration.get('independent_updates', False):
        arms = {'joint_mc': ['--learning-signal', 'mc'], **arms}
    directory = args.directory.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    lock = (directory/'lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    manifest = dict(checkpoint=str(args.checkpoint.resolve()), history=str(args.history.resolve()),
        positions=str(args.positions.resolve()), revision=args.revision, rounds=args.rounds,
        seeds=args.seeds, games=args.games, workers=args.workers, batch=args.batch,
        pairs=args.pairs, arms=arms, curriculum='endgame', development=True,
        protocol='same checkpoint, fixed replay bank and opponent; paired full-game evaluation')
    for key in ('checkpoint', 'history'):
        with open(manifest[key], 'rb') as source:
            manifest[key+'_sha256'] = hashlib.file_digest(source, 'sha256').hexdigest()
    manifest_path = directory/'manifest.json'
    if manifest_path.exists() and json.loads(manifest_path.read_text()) != manifest:
        raise ValueError('Comparison configuration changed; choose a new experiment directory')
    temporary = manifest_path.with_suffix('.tmp')
    temporary.write_text(json.dumps(manifest, indent=2))
    temporary.replace(manifest_path)
    state_path = directory/'status.json'
    state = json.loads(state_path.read_text()) if state_path.exists() else dict(status='prepared', results={})

    def save(**changes):
        state.update(changes, updated_at=datetime.now(timezone.utc).isoformat())
        temporary = state_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(state, indent=2))
        temporary.replace(state_path)

    if args.prepare_only:
        save()
        print(json.dumps(manifest, indent=2))
        return
    if state['status'] == 'error':
        raise RuntimeError('Previous comparison stopped on an error; inspect its archived command and game state')
    environment = {**os.environ, 'XINGBEI_SOURCE_REVISION': args.revision,
                   'XINGBEI_DIAGNOSTIC_DIR': str(directory/'rule-failures')}
    source_root = directory/'source/xingbei-cli'

    def check_control():
        if args.control.exists():
            control = json.loads(args.control.read_text())
            if control.get('state') == 'awaiting_rule_decision':
                raise TrainingWait('waiting_for_rule', 'Global training awaits the user rule ruling: '+str(control.get('last_failure')))
            if control.get('state') == 'paused':
                raise TrainingWait('paused', 'Training is paused at the user request')

    def run(command):
        log_path = directory/'progress.log'
        while True:
            check_control()
            save(status='running', command=command)
            with log_path.open('a', buffering=1) as log:
                log.write('\n'+json.dumps(command)+'\n')
                offset = log.tell()
                result = subprocess.run(command, cwd=source_root, env=environment, stdout=log, stderr=subprocess.STDOUT)
            if result.returncode == 0:
                return
            with log_path.open('rb') as log:
                log.seek(max(offset, log_path.stat().st_size-32768))
                failure = log.read().decode('utf-8', errors='replace')
            if not any(line.startswith(('torch.OutOfMemoryError: CUDA out of memory',
                                        'torch.cuda.OutOfMemoryError: CUDA out of memory'))
                       for line in failure.splitlines()):
                raise subprocess.CalledProcessError(result.returncode, command)
            save(status='waiting_for_gpu', resource_error=failure[-4000:])
            time.sleep(30)

    try:
        check_control()
        if not source_root.exists():
            pending_source = directory/'source.pending'
            if pending_source.exists():
                shutil.rmtree(pending_source)
            for name in ('src', 'training'):
                shutil.copytree(ROOT/name, pending_source/'xingbei-cli'/name,
                                ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
            shutil.copy2(ROOT/'package.json', pending_source/'xingbei-cli/package.json')
            pending_source.rename(directory/'source')
        # SQLite backup gives all arms one consistent immutable bank even if
        # another authorized run later adds positions to the source database.
        positions = directory/'positions.jsonl'
        database = positions.with_suffix('.sqlite3')
        if not database.exists():
            pending = database.with_suffix('.pending')
            pending.unlink(missing_ok=True)
            with PositionBank(args.positions).connection() as source:
                with sqlite3.connect(pending) as destination:
                    source.backup(destination)
            pending.replace(database)
        positions.touch(exist_ok=True)
        # Interleave arms at each round so wall-time drift affects them similarly.
        for round_index in range(args.rounds):
            for seed in args.seeds:
                for arm, flags in arms.items():
                    label = f'{arm}-{seed}'
                    folder = directory/label
                    folder.mkdir(exist_ok=True)
                    parent = args.checkpoint.resolve() if round_index == 0 else folder/f'round-{round_index:04d}.pt'
                    output = folder/f'round-{round_index+1:04d}.pt'
                    if not recover_checkpoint(output):
                        command = [sys.executable, 'training/entity/reinforce.py', str(parent), str(output),
                            '--league', '--positions', str(positions), '--history', manifest['history'],
                            '--revision', args.revision, '--games', str(args.games), '--workers', str(args.workers),
                            '--batch', str(args.batch), '--epochs', '2', '--device', 'cuda']
                        if round_index == 0:
                            command += ['--experiment', label, '--seed', str(seed), '--curriculum', 'endgame',
                                        '--trace-lambda', '0.95', '--morale-weight', '0', *flags]
                        run(command)
                    save(status='ready', round=round_index+1, last_completed=label)
        for seed in args.seeds:
            for arm in arms:
                label = f'{arm}-{seed}'
                folder = directory/label
                output = folder/'evaluation.json'
                if not output.exists():
                    run([sys.executable, 'training/entity/evaluate-all.py',
                         str(folder/f'round-{args.rounds:04d}.pt'), manifest['checkpoint'], str(output),
                         '--revision', args.revision, '--workers', str(args.workers), '--pairs', str(args.pairs)])
                evaluation = json.loads(output.read_text())
                state['results'][label] = {opponent: {key:result[key] for key in
                    ('games', 'wins', 'win_rate', 'truncated', 'paired_seed_interval95')}
                    for opponent, result in evaluation['opponents'].items()}
                if any(row['truncated'] for row in state['results'][label].values()):
                    raise RuntimeError('Comparison evaluation truncated; inspect saved results')
                save()
        save(status='complete')
    except TrainingWait as error:
        save(status=error.status, error=str(error))
        print(str(error))
    except Exception as error:
        save(status='error', error=str(error))
        raise


if __name__ == '__main__':
    main()
