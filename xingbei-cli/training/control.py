"""Persisted user-requested launch deadline; never stops a running learner."""
import json
from datetime import datetime, timezone
from pathlib import Path

CONTROL = Path.home() / '.local/share/xingbei-ml/training-control.json'

def read_control(path=CONTROL):
    return json.loads(path.read_text()) if path.exists() else None

def assert_training_start_allowed(path=CONTROL, now=None):
    control = read_control(path)
    if control is None:
        return
    if control['state'] == 'resumed':
        return
    deadline = datetime.fromisoformat(control['cutoffUtc'].replace('Z', '+00:00'))
    if deadline.tzinfo is None:
        raise ValueError('Training deadline must include a timezone')
    current = now or datetime.now(timezone.utc)
    if control['state'] in ('draining', 'paused') or current >= deadline:
        raise RuntimeError('User-requested training cutoff reached. Preserve existing jobs; explicit user resume is required before launching training.')
    if control['state'] != 'scheduled':
        raise ValueError('Unknown training control state')
