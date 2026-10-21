"""End-to-end restore audit: two batches versus one batch plus a new process."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import torch

p = argparse.ArgumentParser()
p.add_argument('--output', type=Path, required=True)
p.add_argument('--initialize', type=Path, required=True)
p.add_argument('--temperature', type=float, default=1.0)
args = p.parse_args()
args.output.mkdir(parents=True, exist_ok=False)
train = Path(__file__).with_name('train.py')
shared = ['--device', 'cpu', '--encoding', 'decision-context-v6', '--separate-critic', '--baseline', 'v1.5',
          '--baseline-probability', '.95', '--first-seed', '251500000', '--seed', '211', '--games', '2',
          '--workers', '1', '--threads', '1', '--warmup', '0', '--epochs', '1', '--batch-size', '512', '--learning-rate', '.0001', '--temperature', str(args.temperature)]
for name, updates, restore in [('full', 2, False), ('split', 1, False), ('split', 2, True)]:
    directory = args.output / name
    command = [sys.executable, str(train), '--output', str(directory), '--updates', str(updates), *shared]
    command += ['--resume', str(directory / 'checkpoint.pt')] if restore else ['--initialize', str(args.initialize)]
    with (args.output / f'{name}-{updates}.log').open('x') as log:
        subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=120)
a = torch.load(args.output / 'full/checkpoint.pt', map_location='cpu', weights_only=False)
b = torch.load(args.output / 'split/checkpoint.pt', map_location='cpu', weights_only=False)
def equal(a, b):
    if isinstance(a, torch.Tensor):
        return torch.equal(a, b)
    if isinstance(a, dict):
        return a.keys() == b.keys() and all(equal(a[k], b[k]) for k in a)
    if isinstance(a, (list, tuple)):
        return len(a) == len(b) and all(equal(x,y) for x,y in zip(a,b))
    return a == b
checks = {field: equal(a[field], b[field]) for field in ('model', 'optimizer', 'torch_rng', 'python_rng', 'completed')}
report = {'scope': 'CPU single-worker two-batch process restart from trained residual parent; not a GPU bitwise replay guarantee', 'temperature':args.temperature, 'checks':checks}
(args.output / 'report.json').write_text(json.dumps(report, indent=2)+'\n')
assert all(checks.values()), report
print(json.dumps(report))
