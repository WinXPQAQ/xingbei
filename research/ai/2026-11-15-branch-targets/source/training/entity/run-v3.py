"""Run V3 shared training followed by the Sage-specific layer on a single GPU."""
import argparse
import fcntl
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

from checkpoint_io import recover_checkpoint

FROZEN = ('frozen-current.pt', 'frozen-417.pt')
SOURCE = Path(__file__).resolve().parents[2]


def sha256(path):
    with path.open('rb') as data:
        return hashlib.file_digest(data, 'sha256').hexdigest()


def prepare(directory, initial, opponents, revision, phase):
    directory.mkdir(exist_ok=True)
    checkpoints = {name: opponents / name for name in FROZEN}
    checkpoints['sage-initial.pt'] = initial
    digests = {name: sha256(path) for name, path in checkpoints.items()}
    manifest = {
        'revision': revision,
        'ruleVariant': 'standard',
        'checkpoint_sha256': {name: digests[name] for name in FROZEN},
        'initial_checkpoints': {'sage': {'file': 'sage-initial.pt', 'sha256': digests['sage-initial.pt']}},
        'lineage': {'initial': str(initial), 'mode': 'hierarchical-v3', 'phase': phase},
        'training_offset': 3700000 if phase == 'shared' else 3900000,
    }
    metadata = directory / 'manifest.json'
    if metadata.exists() and json.loads(metadata.read_text()) != manifest:
        raise ValueError(f'Run parameters differ from existing manifest: {directory}')
    for name, path in checkpoints.items():
        target = directory / name
        if not target.exists():
            pending = target.with_suffix('.pt.copying')
            shutil.copyfile(path, pending)
            pending.replace(target)
        if sha256(target) != digests[name]:
            raise ValueError(f'Checkpoint content changed: {target}')
    if not metadata.exists():
        pending = metadata.with_suffix('.json.tmp')
        pending.write_text(json.dumps(manifest, indent=2) + '\n')
        pending.replace(metadata)


def latest(directory):
    return next((p for p in sorted((directory / 'sage').glob('round-*.pt'), reverse=True)
                 if recover_checkpoint(p)), None)


def train(args, directory, phase, rounds):
    cmd = [sys.executable, 'training/entity/specialists.py', str(directory),
           '--heroes', 'sage', '--decision-mode', 'hierarchical-v3', '--v3-phase', phase,
           '--workers', str(args.workers), '--games', str(args.games),
           '--eval-games', str(args.eval_games), '--eval-seed', str(args.eval_seed),
           '--rounds', str(rounds)]
    if phase == 'shared':
        cmd.append('--team')
    print(json.dumps({'phase': phase, 'workers': args.workers, 'directory': str(directory), 'rounds': rounds}), flush=True)
    subprocess.run(cmd, cwd=SOURCE, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--initial', type=Path, required=True)
    parser.add_argument('--opponents', type=Path, required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--workers', type=int, required=True)
    parser.add_argument('--games', type=int, default=192)
    parser.add_argument('--eval-games', type=int, default=288)
    parser.add_argument('--eval-seed', type=int, default=940000000)
    parser.add_argument('--shared-rounds', type=int, default=8)
    parser.add_argument('--sage-rounds', type=int, default=0, help='Additional rounds. Zero runs until paused.')
    args = parser.parse_args()
    if (min(args.workers, args.games, args.eval_games, args.shared_rounds) < 1
            or args.games % 6 or args.eval_games % 6 or args.sage_rounds < 0):
        parser.error('Use positive workers/rounds and game counts divisible by six')
    directory = args.directory.resolve()
    initial = args.initial.resolve()
    opponents = args.opponents.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / 'pipeline.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        shared = directory / 'shared'
        prepare(shared, initial, opponents, args.revision, 'shared')
        checkpoint = latest(shared)
        completed = int(checkpoint.stem.split('-')[1]) if checkpoint else 0
        if completed > args.shared_rounds:
            raise ValueError('Shared phase already went beyond the requested Sage starting round')
        if (shared / 'PAUSE').exists():
            return
        if completed < args.shared_rounds:
            train(args, shared, 'shared', args.shared_rounds - completed)
            checkpoint = latest(shared)
        if (shared / 'PAUSE').exists():
            return
        if not checkpoint or checkpoint.name != f'round-{args.shared_rounds:06d}.pt':
            raise RuntimeError('Shared phase did not finish at the requested checkpoint')
        sage = directory / 'sage'
        prepare(sage, checkpoint, opponents, args.revision, 'sage')
        train(args, sage, 'sage', args.sage_rounds)


if __name__ == '__main__':
    main()
