"""One idempotent monitor tick; run from a systemd user timer, not a chat loop."""
import argparse
import datetime
import fcntl
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

TERMINAL = {'complete', 'failed', 'monitor-error'}
LIVE = {'active', 'activating', 'deactivating', 'reloading'}


def read(path):
    return json.loads(path.read_text())


def atomic(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def unit_state(name):
    result = subprocess.run(['systemctl', '--user', 'show', name,
                             '--property=ActiveState', '--value'], capture_output=True, text=True, timeout=10)
    if result.returncode:
        raise RuntimeError(f'Cannot inspect {name}: {result.stderr.strip()}')
    return result.stdout.strip() or 'missing'


def classify(training_done, validation_done, training_state, validation_state):
    if training_done and validation_done:
        return 'complete'
    if not training_done and training_state not in LIVE:
        return 'failed'
    if not validation_done and validation_state not in LIVE:
        return 'failed'
    return 'running'


def inspect_arm(root, protocol, name):
    run = root / 'runs' / name
    metrics = run / 'metrics.jsonl'
    # Ignore an append currently in progress.
    rows = [json.loads(line) for line in metrics.read_text().splitlines(keepends=True)
            if line.endswith('\n')] if metrics.exists() else []
    target = protocol['shared']['updates']
    completed = rows[-1]['iteration'] + 1 if rows else 0
    training_done = completed == target and (run / f'checkpoint-{target}.pt').exists()
    series_path = root / 'evidence' / f'{name}-series.json'
    series = read(series_path)['results'] if series_path.exists() else []
    milestones = protocol['development']['checkpoints']
    validation_done = [r['completed'] for r in series] == milestones
    train_state = unit_state(f'xingbei-ml-{name}.service')
    validation_state = unit_state(f'xingbei-ml-validate-{name}.service')
    result = {'name': name, 'completed': completed, 'target': target,
              'games': sum(len(r['games']) for r in rows),
              'truncated': sum(r['truncatedExcluded'] for r in rows),
              'trainingState': train_state, 'validationState': validation_state,
              'evaluations': series,
              'state': classify(training_done, validation_done, train_state, validation_state)}
    if result['state'] == 'complete':
        if [r['iteration'] for r in rows] != list(range(target)):
            raise ValueError(f'{name}: incomplete training iterations')
        shared = protocol['shared']
        seeds = [g['seed'] for r in rows for g in r['games']]
        if seeds != list(range(shared['firstSeed'], shared['lastSeed'] + 1)):
            raise ValueError(f'{name}: training seed coverage mismatch')
        hashes = {}
        for checkpoint in milestones:
            model_path = run / f'checkpoint-{checkpoint}.pt'
            digest = hashlib.sha256(model_path.read_bytes()).hexdigest()
            evaluation = root / 'evaluations' / f'{name}-{checkpoint}-greedy'
            manifest = read(evaluation / 'manifest.json')
            if manifest['checkpointSha256'] != digest or manifest['games'] != protocol['development']['recordsPerEvaluation']:
                raise ValueError(f'{name}: checkpoint/evaluation mismatch')
            expected = protocol['development']
            if (manifest['firstSeed'] != expected['firstSeed']
                    or manifest['seeds'] != expected['seeds']
                    or manifest['checkpointUpdates'] != checkpoint
                    or manifest['selection'] != 'greedy policy'
                    or not manifest['balancedMixedSchedule']):
                raise ValueError(f'{name}: evaluation protocol mismatch')
            # Re-audit complete schedules and recompute breakdown from actual records.
            output = root / 'evidence' / f'{name}-{checkpoint}-monitor-audit.json'
            subprocess.run([sys.executable, str(run / 'source/training/evaluation_breakdown.py'),
                            '--evaluation', str(evaluation), '--sampling-seed', str(shared['seed']),
                            '--output', str(output)], check=True, capture_output=True, timeout=60)
            hashes[str(checkpoint)] = digest
        result['checkpointHashes'] = hashes
    return result


def tick(root, protocol):
    arms = [inspect_arm(root, protocol, arm['name']) for arm in protocol['arms']]
    state = 'failed' if any(a['state'] == 'failed' for a in arms) else (
        'complete' if all(a['state'] == 'complete' for a in arms) else 'running')
    result = {'state': state, 'experiment': protocol['name'],
              'checkedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'scope': 'Development experiment only; not 70% independent acceptance.', 'arms': arms}
    if state == 'complete':
        if len(arms) != 2:
            raise ValueError('Paired monitor requires two registered arms')
        source = root / 'runs' / arms[1]['name'] / 'source/training/compare_checkpoints.py'
        result['paired'] = []
        for checkpoint in protocol['development']['checkpoints']:
            output = root / 'evidence' / f"{protocol['name']}-{checkpoint}-monitor-paired.json"
            evaluations = [root / 'evaluations' / f"{arm['name']}-{checkpoint}-greedy" for arm in arms]
            subprocess.run([sys.executable, str(source), '--baseline', str(evaluations[0]),
                            '--candidate', str(evaluations[1]), '--output', str(output)],
                           capture_output=True, check=True, timeout=60)
            result['paired'].append({'checkpoint': checkpoint, 'path': str(output), 'result': read(output)})
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--protocol', type=Path, required=True)
    parser.add_argument('--root', type=Path, default=Path.home() / '.local/share/xingbei-ml')
    parser.add_argument('--timer', help='Stop this monitor timer after a terminal result')
    args = parser.parse_args()
    protocol = read(args.protocol)
    for name in [protocol['name'], *(a['name'] for a in protocol['arms'])]:
        if not re.fullmatch('[a-z0-9-]+', name):
            raise ValueError('Invalid experiment/run name')
    if args.timer and args.timer != f"xingbei-ml-watch-{protocol['name']}.timer":
        raise ValueError('Timer must belong to this experiment')
    output = args.root / 'monitors' / protocol['name']
    output.mkdir(parents=True, exist_ok=True)
    with (output / 'monitor.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        status_path = output / 'status.json'
        old = read(status_path) if status_path.exists() else {}
        if old.get('state') in TERMINAL:
            result = old
        else:
            try:
                result = tick(args.root, protocol)
            except Exception as error:
                failures = old.get('consecutiveMonitorErrors', 0) + 1
                result = {'state': 'monitor-error' if failures >= 3 else 'retrying',
                          'experiment': protocol['name'],
                          'consecutiveMonitorErrors': failures, 'error': str(error), 'checkedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat()}
            atomic(status_path, result)
            if result['state'] in TERMINAL:
                lines = [f"# {protocol['name']}: {result['state']}", '',
                         '开发实验结果，不代表70%独立验收通过。', '']
                for arm in result.get('arms', []):
                    lines.append(f"- {arm['name']}: {arm['completed']}/{arm['target']}批，{arm['games']}局，截断{arm['truncated']}")
                    for evaluation in arm['evaluations']:
                        lines.append(f"  - 第{evaluation['completed']}批：全队{evaluation['team']['resolvedWinRate']:.2%}，混合{evaluation['mixed']['resolvedWinRate']:.2%}")
                if result.get('error'):
                    lines.append('错误：' + result['error'])
                lines += ['', '完整统计、配对区间、审计路径见同目录status.json。模型与优化器保留在runs目录；不自动部署、重启训练或启动下一轮。']
                (output / 'summary.md').write_text('\n'.join(lines) + '\n')
                # One terminal journal event, optional local desktop notification.
                message = f"{protocol['name']}: {result['state']}; {output / 'summary.md'}"
                print(message, flush=True)
                if shutil.which('notify-send'):
                    try:
                        notification = subprocess.run(['notify-send', '星杯AI训练监测', message], capture_output=True, text=True, timeout=5)
                        notice = {'returncode': notification.returncode, 'stderr': notification.stderr}
                    except Exception as error:
                        notice = {'error': str(error)}
                    atomic(output / 'desktop-notification.json', notice)
        if result['state'] in TERMINAL and args.timer:
            subprocess.run(['systemctl', '--user', 'stop', args.timer], check=True, timeout=10)


if __name__ == '__main__':
    main()
