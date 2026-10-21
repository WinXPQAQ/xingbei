"""Bounded post-training validation; never accesses the reserved final partition."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time

import torch

parser = argparse.ArgumentParser()
parser.add_argument('--unit', required=True)
parser.add_argument('--name', required=True)
parser.add_argument('--updates', type=int, required=True)
parser.add_argument('--checkpoint-name', choices=['imitation.pt', 'checkpoint.pt'], default='imitation.pt')
args = parser.parse_args()
root = Path.home() / '.local/share/xingbei-ml'
started = time.monotonic()
while subprocess.run(['systemctl', '--user', 'is-active', '--quiet', args.unit]).returncode == 0:
    if time.monotonic() - started > 1800:
        raise TimeoutError('Training wait exceeded stage budget')
    time.sleep(5)
checkpoint = root / 'runs' / args.name / args.checkpoint_name
saved = torch.load(checkpoint, map_location='cpu', weights_only=False)
if saved['completed'] != args.updates:
    raise ValueError('Incomplete training budget; refusing endpoint validation')
subprocess.run([sys.executable, 'training/imitation_check.py', '--checkpoint', str(checkpoint),
                '--output', str(root / 'evidence' / f'{args.name}-teacher.json'),
                '--first-seed', '230010000'], check=True)
reports = {}
for greedy in (True, False):
    label = 'greedy' if greedy else 'sampled'
    output = root / 'evaluations' / f'{args.name}-{label}'
    command = [sys.executable, 'training/evaluate.py', '--checkpoint', str(checkpoint),
               '--output', str(output), '--first-seed', '231000000', '--seeds', '18',
               '--workers', '8', '--device', 'cuda', '--balanced-mixed']
    if greedy:
        command.append('--greedy')
    subprocess.run(command, check=True)
    reports[label] = json.loads((output / 'report.json').read_text())
(root / 'evidence' / f'{args.name}-validation.json').write_text(json.dumps(reports, indent=2) + '\n')
