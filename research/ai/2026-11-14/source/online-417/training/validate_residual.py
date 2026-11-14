"""Complete a declared residual trial's paired development comparison."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time

parser = argparse.ArgumentParser()
parser.add_argument('--name', default='residual-v1-211')
parser.add_argument('--updates', type=int, default=24)
parser.add_argument('--wait-seconds', type=int, default=1800)
args = parser.parse_args()
if any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for c in args.name) or not args.name:
    raise ValueError('Invalid experiment name')
root = Path.home() / '.local/share/xingbei-ml'
run = root / 'runs' / args.name
source = run / 'source/training'
initial = root / 'evaluations/residual-v1-initial-greedy'
final = root / 'evaluations' / (args.name + '-final-greedy')
deadline = time.monotonic() + args.wait_seconds
while True:
    state = subprocess.check_output(['systemctl', '--user', 'show', '--property=ActiveState', '--value',
                                     'xingbei-ml-' + args.name + '.service'], text=True).strip()
    if state in ('failed', 'inactive'):
        break
    if state not in ('active', 'activating', 'deactivating'):
        raise RuntimeError('Unknown training state: ' + state)
    if time.monotonic() > deadline:
        raise RuntimeError('Training wait exceeded bounded validation budget')
    time.sleep(5)
metrics = [json.loads(line) for line in (run / 'metrics.jsonl').read_text().splitlines()]
if len(metrics) != args.updates or metrics[-1]['iteration'] != args.updates - 1:
    raise RuntimeError('Training incomplete; refusing to evaluate as completed trial')
with (root / 'evidence' / (args.name + '-final-eval.log')).open('x') as log:
    subprocess.run([sys.executable, str(source / 'evaluate.py'), '--checkpoint', str(run / 'checkpoint.pt'),
                    '--output', str(final), '--first-seed', '231000000', '--seeds', '6', '--workers', '2',
                    '--threads', '2', '--device', 'cuda', '--greedy', '--balanced-mixed'], stdout=log, stderr=subprocess.STDOUT, check=True, timeout=600)
if not (initial / 'report.json').exists():
    raise RuntimeError('Completed initial evaluation required')
subprocess.run([sys.executable, str(source / 'compare_checkpoints.py'), '--baseline', str(initial),
                '--candidate', str(final), '--output', str(root / 'evidence' / (args.name + '-paired.json'))], check=True)
