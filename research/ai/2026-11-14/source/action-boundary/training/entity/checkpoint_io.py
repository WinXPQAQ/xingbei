"""Commit a checkpoint and its report, using the final report as completion marker."""
import json
import os
from pathlib import Path
import time


def _commit(destination, pending_model, report, pending_report):
    directory = os.open(destination.parent, os.O_RDONLY)
    try:
        if not destination.exists():
            pending_model.replace(destination)
        os.fsync(directory)
        pending_report.replace(report)
        os.fsync(directory)
    finally:
        os.close(directory)


def recover_checkpoint(destination):
    destination = Path(destination)
    report = Path(str(destination) + '.json')
    pending_model = Path(str(destination) + '.pending')
    pending_report = Path(str(report) + '.pending')
    if report.exists():
        if not destination.exists():
            raise RuntimeError(f'Checkpoint completion marker has no model: {report}')
        json.loads(report.read_text())
        return True

    metadata = None
    if pending_report.exists():
        try:
            metadata = json.loads(pending_report.read_text())
        except (ValueError, UnicodeError):
            pass
    if isinstance(metadata, dict) and (destination.exists() or pending_model.exists()):
        _commit(destination, pending_model, report, pending_report)
        return True

    # A pending report is written only after the model is fully flushed. Without
    # it the model cannot be trusted. Preserve interrupted files for diagnosis,
    # including older writers' orphan final models, and rerun from the parent.
    suffix = f'.incomplete-{time.time_ns()}'
    for path in (pending_model, pending_report, destination):
        if path.exists():
            path.rename(Path(str(path) + suffix))
    return False


def save_checkpoint(destination, checkpoint, report):
    import torch

    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if recover_checkpoint(destination):
        raise FileExistsError(f'Completed checkpoint already exists: {destination}')
    pending_model = Path(str(destination) + '.pending')
    pending_report = Path(str(destination) + '.json.pending')
    with pending_model.open('xb') as output:
        torch.save(checkpoint, output)
        output.flush()
        os.fsync(output.fileno())
    with pending_report.open('x') as output:
        json.dump(report, output, indent=2)
        output.flush()
        os.fsync(output.fileno())
    _commit(destination, pending_model, Path(str(destination) + '.json'), pending_report)
