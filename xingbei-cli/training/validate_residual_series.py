"""Watch immutable periodic checkpoints; evaluate every preregistered milestone."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time

parser = argparse.ArgumentParser()
parser.add_argument('--name', default='residual-resume-211')
parser.add_argument('--checkpoints', type=int, nargs='+', default=[192, 288, 384, 480])
parser.add_argument('--compare-against', default='residual-long-211-expanded-greedy')
args = parser.parse_args()
for name_value in (args.name, args.compare_against):
    if not name_value or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for c in name_value):
        raise ValueError('Invalid run/evaluation name')
if args.checkpoints != sorted(set(args.checkpoints)) or args.checkpoints[0] <= 0:
    raise ValueError('Checkpoints must be positive, unique and increasing')
root = Path.home() / '.local/share/xingbei-ml'
name = args.name
run = root / 'runs' / name
source = run / 'source/training'
unit = 'xingbei-ml-' + name + '.service'
completed_reports = []
deadline = time.monotonic() + 6600
for completed in args.checkpoints:
    checkpoint = run / f'checkpoint-{completed}.pt'
    while True:
        metrics = run / 'metrics.jsonl'
        lines = metrics.read_text().splitlines(keepends=True) if metrics.exists() else []
        # Metrics are appended only AFTER the periodic checkpoint copy finishes.
        rows = [json.loads(line) for line in lines if line.endswith('\n')]
        if rows and rows[-1]['iteration'] + 1 >= completed and checkpoint.exists():
            break
        state = subprocess.check_output(['systemctl', '--user', 'show', '--property=ActiveState', '--value', unit], text=True).strip()
        if state in ('inactive', 'failed'):
            raise RuntimeError(f'Training ended before checkpoint {completed}')
        if state not in ('active', 'activating', 'deactivating') or time.monotonic() > deadline:
            raise RuntimeError('Unknown training state or validation deadline exceeded')
        time.sleep(5)
    destination = root / 'evaluations' / f'{name}-{completed}-greedy'
    with (root / 'evidence' / f'{name}-{completed}-eval.log').open('x') as log:
        subprocess.run([sys.executable, str(source / 'evaluate.py'), '--checkpoint', str(checkpoint),
                        '--output', str(destination), '--first-seed', '231000000', '--seeds', '18', '--workers', '4',
                        '--threads', '2', '--device', 'cuda', '--greedy', '--balanced-mixed'],
                       check=True, stdout=log, stderr=subprocess.STDOUT, timeout=900)
    detail = root / 'evidence' / f'{name}-{completed}-breakdown.json'
    subprocess.run([sys.executable, str(source / 'evaluation_breakdown.py'), '--evaluation', str(destination),
                    '--sampling-seed', '211', '--output', str(detail)], check=True, timeout=60)
    subprocess.run([sys.executable, str(source / 'compare_checkpoints.py'),
                    '--baseline', str(root / 'evaluations' / args.compare_against),
                    '--candidate', str(destination), '--output', str(root / 'evidence' / f'{name}-{completed}-paired.json')], check=True, timeout=60)
    report = json.loads((destination / 'report.json').read_text())
    completed_reports.append({'completed': completed, 'team': report['team'], 'mixed': report['mixed'],
                              'report': str(destination / 'report.json'), 'breakdown':str(detail)})
    target = root / 'evidence' / f'{name}-series.json'
    temporary = target.with_suffix('.tmp')
    temporary.write_text(json.dumps({'scope':'Predeclared development milestones, not independent acceptance', 'results':completed_reports}, indent=2)+'\n')
    temporary.replace(target)
    print(json.dumps(completed_reports[-1]), flush=True)
