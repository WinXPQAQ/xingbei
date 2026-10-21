"""Complete the preregistered residual pilot's paired development comparison."""
import json
from pathlib import Path
import subprocess
import sys
import time

root = Path.home() / '.local/share/xingbei-ml'
run = root / 'runs/residual-v1-211'
source = run / 'source/training'
initial = root / 'evaluations/residual-v1-initial-greedy'
final = root / 'evaluations/residual-v1-final-greedy'
deadline = time.monotonic() + 900
while subprocess.run(['systemctl', '--user', 'is-active', '--quiet', 'xingbei-ml-residual-v1-211.service']).returncode == 0:
    if time.monotonic() > deadline:
        raise RuntimeError('Training wait exceeded bounded validation budget')
    time.sleep(5)
metrics = [json.loads(line) for line in (run / 'metrics.jsonl').read_text().splitlines()]
if len(metrics) != 24 or metrics[-1]['iteration'] != 23:
    raise RuntimeError('Training incomplete; refusing to evaluate as completed pilot')
with (root / 'evidence/residual-v1-final-eval.log').open('x') as log:
    subprocess.run([sys.executable, str(source / 'evaluate.py'), '--checkpoint', str(run / 'checkpoint.pt'),
                    '--output', str(final), '--first-seed', '231000000', '--seeds', '6', '--workers', '2',
                    '--threads', '2', '--device', 'cuda', '--greedy', '--balanced-mixed'], stdout=log, stderr=subprocess.STDOUT, check=True, timeout=600)
while not (initial / 'report.json').exists():
    if time.monotonic() > deadline:
        raise RuntimeError('Initial evaluation did not complete')
    time.sleep(5)
subprocess.run([sys.executable, str(source / 'compare_checkpoints.py'), '--baseline', str(initial),
                '--candidate', str(final), '--output', str(root / 'evidence/residual-v1-paired.json')], check=True)
