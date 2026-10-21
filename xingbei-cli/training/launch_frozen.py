"""Freeze executable sources before starting a resource-bounded local experiment."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
from control import assert_training_start_allowed

parser = argparse.ArgumentParser()
parser.add_argument('--name', required=True)
parser.add_argument('--minutes', type=int, default=30)
parser.add_argument('--cpu', default='800%')
parser.add_argument('--memory', default='12G')
parser.add_argument('--prepare-only', action='store_true')
parser.add_argument('training_args', nargs=argparse.REMAINDER)
args = parser.parse_args()
if not args.name or any(character not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for character in args.name):
    raise ValueError('Experiment name must use lowercase letters, digits and hyphens')
if not 1 <= args.minutes <= 120:
    raise ValueError('Choose a bounded stage of 1 to 120 minutes')
training_args = args.training_args[1:] if args.training_args[:1] == ['--'] else args.training_args
if any(value == '--output' or value.startswith('--output=') for value in training_args):
    raise ValueError('Output is controlled by the frozen experiment launcher')
if not args.prepare_only:
    assert_training_start_allowed()
project = Path(__file__).resolve().parent.parent
root = Path.home() / '.local/share/xingbei-ml'
output = root / 'runs' / args.name
source = output / 'source'
source.mkdir(parents=True, exist_ok=False)
shutil.copytree(project / 'src', source / 'src')
shutil.copy2(project / 'package.json', source / 'package.json')
(source / 'training').mkdir()
for path in (project / 'training').iterdir():
    if path.is_file():
        shutil.copy2(path, source / 'training' / path.name)
hashes = {str(path.relative_to(source)): hashlib.sha256(path.read_bytes()).hexdigest()
          for path in source.rglob('*') if path.is_file()}
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=project, text=True).strip()
diff = subprocess.check_output(['git', 'diff', '--binary', 'HEAD'], cwd=project)
(output / 'source-working-diff.patch').write_bytes(diff)
command = [str(root / 'venv-gpu/bin/python'), str(source / 'training/train.py'),
           '--output', str(output), *training_args]
manifest = {'sourceCommit': commit, 'sourceHashes': hashes, 'command': command,
            'resourceLimits': {'minutes': args.minutes, 'cpu': args.cpu, 'memory': args.memory},
            'note': 'All engine and learner files execute from this immutable-by-convention local snapshot.'}
(output / 'launch-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
if not args.prepare_only:
    log = root / 'evidence' / f'{args.name}.log'
    subprocess.run(['systemd-run', '--user', '--unit=xingbei-ml-' + args.name,
                    '--property=MemoryMax=' + args.memory, '--property=CPUQuota=' + args.cpu,
                    '--property=RuntimeMaxSec=' + str(args.minutes * 60),
                    '--working-directory=' + str(source),
                    '--property=StandardOutput=append:' + str(log),
                    '--property=StandardError=append:' + str(log), *command], check=True)
print(json.dumps({'output': str(output), 'sourceFiles': len(hashes), 'started': not args.prepare_only}))
