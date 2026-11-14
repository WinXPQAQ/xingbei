"""Bounded full-game throughput comparison with a fixed policy and game list."""
import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import time
import torch
from model import policy_from_checkpoint
from rollout import collect, SAMPLING_VERSION
from schedule import training_configs

async def run(args):
    torch.set_num_threads(2)
    saved = torch.load(args.checkpoint, map_location='cuda', weights_only=False)
    model = policy_from_checkpoint(saved, 'cuda')
    configs = training_configs(251400000, 0, 48, 211, False)
    measurements, reference = [], None
    for workers in (4, 8, 12, 4):
        start = time.perf_counter()
        _, games, batches = await collect(model, configs, workers, 'cuda', retain=False)
        seconds = time.perf_counter() - start
        if reference is None:
            reference = games
        measurements.append({'workers': workers, 'seconds': seconds, 'gamesPerSecond': len(games)/seconds,
                             'decisionsPerSecond': sum(g['decisions'] for g in games)/seconds,
                             'meanInferenceBatch': sum(batches)/max(1,len(batches)),
                             'sameGameResultsAsFirstRun': games == reference,
                             'truncated': sum(g['truncated'] for g in games)})
        print(json.dumps(measurements[-1]), flush=True)
    report = {'checkpoint': str(args.checkpoint), 'sha256': hashlib.sha256(args.checkpoint.read_bytes()).hexdigest(),
              'samplingVersion': SAMPLING_VERSION, 'firstSeed': 251400000, 'gamesPerMeasurement':48,
              'scope': 'Training-range throughput only; concurrent training creates contention. Repeated 4-worker endpoint checks drift. Same final game summaries are not a per-decision identity proof.',
              'measurements': measurements}
    with args.output.open('x') as stream:
        json.dump(report, stream, indent=2)

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--checkpoint', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    asyncio.run(run(p.parse_args()))
