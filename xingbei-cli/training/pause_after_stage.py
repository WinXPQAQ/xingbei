"""At the requested deadline, drain registered ML jobs and write a handoff.

This controls local training only. Thread goal status is updated by the agent
when it reads the completed handoff, not by pretending a file changes that API.
"""
import hashlib
import json
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from control import CONTROL, read_control

ROOT = Path.home() / '.local/share/xingbei-ml'

def atomic(path, data):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    temporary.replace(path)

def registered_units(root):
    names = []
    for manifest in (root / 'runs').glob('*/launch-manifest.json'):
        name = manifest.parent.name
        names.extend([f'xingbei-ml-{name}.service', f'xingbei-ml-validate-{name}.service'])
    return names

def active_jobs(root):
    jobs = []
    for unit in registered_units(root):
        state = subprocess.check_output(['systemctl', '--user', 'show', unit, '--property=ActiveState', '--value'], text=True).strip()
        if state in ('active', 'activating', 'deactivating', 'reloading'):
            jobs.append(unit)
        elif state not in ('inactive', 'failed'):
            raise RuntimeError(f'Unknown job state: {unit}: {state}')
    return jobs

def handoff(root):
    runs = []
    for manifest in sorted((root / 'runs').glob('residual-*/launch-manifest.json')):
        run = manifest.parent
        checkpoint = run / 'checkpoint.pt'
        if not checkpoint.exists():
            continue
        metrics = run / 'metrics.jsonl'
        rows = [json.loads(line) for line in metrics.read_text().splitlines(keepends=True) if line.endswith('\n')] if metrics.exists() else []
        launch = json.loads(manifest.read_text())
        completed = rows[-1]['iteration'] + 1 if rows else None
        target = int(launch['command'][launch['command'].index('--updates')+1])
        command = launch['command'][:]
        for option in ('--initialize', '--resume'):
            if option in command:
                offset = command.index(option); del command[offset:offset+2]
        if completed is not None:
            command[command.index('--updates')+1] = str(completed + 192)
        command += ['--resume', str(checkpoint)]
        runs.append({'name': run.name, 'latestCheckpoint': str(checkpoint), 'sha256': hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
                     'completed': completed, 'plannedUpdates': target, 'plannedTrainingCompleted': completed == target, 'metrics': str(metrics), 'launchManifest': str(manifest),
                     'resumeCommandTemplate': command, 'note': 'Template only: user must resume and approve next bounded protocol; do not run all templates.'})
    evaluations = []
    for directory in sorted((root / 'evaluations').glob('residual-*')):
        if not (directory/'report.json').exists() or not (directory/'manifest.json').exists():
            continue
        m = json.loads((directory/'manifest.json').read_text()); r = json.loads((directory/'report.json').read_text())
        if m.get('baselineVersion') != 'v1.5' or m.get('seeds') != 18 or m.get('firstSeed') != 231000000:
            continue
        evaluations.append({'directory': str(directory), 'checkpoint': m['checkpoint'], 'sha256': m['checkpointSha256'], 'team': r['team'], 'mixed': r['mixed']})
    best = max(evaluations, key=lambda r:r['team']['resolvedWinRate'], default=None)
    deployed = root/'preview/deployment.json'
    return {'state': 'paused', 'finishedAtUtc': datetime.now(timezone.utc).isoformat(), 'activeJobs': [], 'runs': runs,
            'bestDevelopmentModel': best, 'evaluations': evaluations, 'finalIndependentSeedsUsed': False,
            'deployedPreview': json.loads(deployed.read_text()) if deployed.exists() else None,
            'goalStatusUpdate': 'pending agent update_goal(paused); this file does not change the thread goal API',
            'scope': 'Local training naturally drained. No process killed or model/service switched. Development result is not independent acceptance.'}

def main():
    control = read_control()
    if control is None or control['state'] == 'resumed':
        raise RuntimeError('No active pause request')
    deadline = datetime.fromisoformat(control['cutoffUtc'].replace('Z', '+00:00'))
    if datetime.now(timezone.utc) < deadline:
        raise RuntimeError('Refusing to pause before the requested cutoff')
    control['state'] = 'draining'; atomic(CONTROL, control)
    while True:
        jobs = active_jobs(ROOT)
        if not jobs:
            break
        atomic(ROOT/'evidence/training-drain-status.json', {'state':'draining', 'activeJobs':jobs, 'checkedAtUtc':datetime.now(timezone.utc).isoformat()})
        time.sleep(15)
    report = handoff(ROOT)
    atomic(ROOT/'evidence/training-pause-handoff.json', report)
    control.update(state='paused', finishedAtUtc=report['finishedAtUtc'], handoff=str(ROOT/'evidence/training-pause-handoff.json'))
    atomic(CONTROL, control)
    print(json.dumps({'state':'paused','handoff':control['handoff']}), flush=True)

if __name__ == '__main__':
    main()
