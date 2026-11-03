"""One recoverable training/evaluation batch per timer tick. Artifacts stay local."""
import argparse
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import traceback
import time

ROOT = Path(__file__).resolve().parents[2]


def now(): return datetime.now(timezone.utc).isoformat()


def tick(directory):
    directory.mkdir(parents=True, exist_ok=True)
    with open(directory/'lock', 'a') as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: return
        state_path = directory/'status.json'
        state = json.loads(state_path.read_text()) if state_path.exists() else dict(cycle=0, history=[], stage='collect')
        def save(**changes):
            state.update(changes, updated_at=now())
            temporary = state_path.with_suffix('.tmp'); temporary.write_text(json.dumps(state, indent=2)); temporary.replace(state_path)
        if (directory/'PAUSE').exists(): save(status='paused'); return
        if state.get('status') == 'error': return  # Preserve evidence; do not endlessly restart broken jobs.
        memory = subprocess.check_output(['nvidia-smi', '--query-gpu=memory.free', '--format=csv,noheader,nounits'], text=True)
        if int(memory.splitlines()[0]) < 1800:
            save(status='waiting_for_gpu', reason='Need 1800 MiB free; other GPU services are left running'); return
        def run(command):
            save(status='running', command=command, started_at=now())
            with open(directory/'progress.log', 'a', buffering=1) as log:
                log.write(f'\n{now()} {command!r}\n')
                subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, check=True)
        try:
            if state['stage'] == 'collect':
                data = directory/'teacher.jsonl'
                run(['node', 'training/entity/collect.mjs', str(data), '60', '311102000'])
                save(stage='bootstrap')
            if state['stage'] == 'bootstrap':
                checkpoint = directory/'bootstrap.pt'
                run([sys.executable, 'training/entity/train.py', str(directory/'teacher.jsonl'), str(checkpoint),
                     '--steps', '2000', '--batch', '32', '--device', 'cuda'])
                save(stage='evaluate', latest=str(checkpoint))
            if state['stage'] == 'reinforce':
                cycle = state['cycle']+1
                checkpoint = directory/f'cycle-{cycle:04d}.pt'
                run([sys.executable, 'training/entity/reinforce.py', state['latest'], str(checkpoint),
                     '--rounds', '1', '--games', '96', '--workers', '4', '--batch', '32', '--epochs', '2',
                     '--seed', '611102000', '--device', 'cuda'])
                save(stage='evaluate' if cycle % 5 == 0 else 'reinforce', latest=str(checkpoint), cycle=cycle, status='ready')
            if state['stage'] == 'evaluate':
                output = directory/f"evaluation-{state['cycle']:04d}.json"
                run([sys.executable, 'training/entity/evaluate.py', state['latest'], str(output), '--pairs', '36', '--device', 'cuda'])
                report = json.loads(output.read_text())
                metrics = {name:{k:v for k,v in row.items() if k not in ['stats','results']} for name,row in report['opponents'].items()}
                primary = metrics['v1.8.0-preview.1']
                if primary['truncated']: raise RuntimeError('Truncated evaluation; do not rank incomplete runs')
                score = primary['win_rate']
                improved = 'best_score' not in state or score > state['best_score']
                if improved: state.update(best=state['latest'], best_score=score, best_evaluation=str(output))
                state['history'].append(dict(cycle=state['cycle'], checkpoint=state['latest'], metrics=metrics,
                                             evaluation=str(output), finished_at=now(), improved=improved))
                save(stage='reinforce', status='waiting_for_next_tick', metrics=metrics, reason=None)
                print(json.dumps(dict(cycle=state['cycle'], improved=improved, metrics=metrics)), flush=True)
        except Exception:
            save(status='error', error=traceback.format_exc())
            raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    parser.add_argument('--continuous', action='store_true')
    parser.add_argument('--monitor', action='store_true')
    args = parser.parse_args()
    directory = args.directory.resolve()
    if args.monitor:
        state = json.loads((directory/'status.json').read_text())
        active = subprocess.run(['systemctl', '--user', 'is-active', 'xingbei-entity-training.service'], capture_output=True, text=True).stdout.strip()
        (directory/'monitor.json').write_text(json.dumps(dict(checked_at=now(), service=active, cycle=state['cycle'], status=state['status'])))
        if active not in ['active', 'activating'] and state['status'] != 'error' and not (directory/'PAUSE').exists():
            subprocess.run(['systemctl', '--user', 'start', '--no-block', 'xingbei-entity-training.service'], check=True)
    else:
        while True:
            tick(directory)
            state = json.loads((directory/'status.json').read_text())
            if not args.continuous or state['status'] in ['paused', 'error']: break
            time.sleep(60 if state['status'] == 'waiting_for_gpu' else 1)
