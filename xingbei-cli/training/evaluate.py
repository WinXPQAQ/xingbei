"""Run a frozen checkpoint against v1.5; output paired raw games and uncertainty."""
import argparse
import asyncio
import hashlib
import json
import pathlib
import subprocess
import time

import torch
from model import policy_from_checkpoint, Policy, SCHEMA, SeatMemory, batch
from rollout import collect, SAMPLING_VERSION
from schedule import evaluation_configs, LINEUPS
from evaluation_stats import summarize, paired_mixed
from encoding_candidate import seat_memory


async def run(args):
    torch.set_num_threads(args.threads)
    saved = torch.load(args.checkpoint, map_location=args.device, weights_only=False)
    if saved['schema'] != SCHEMA:
        raise ValueError('Unsupported checkpoint schema')
    model = policy_from_checkpoint(saved, args.device)
    configs = evaluation_configs(args.first_seed, args.seeds, saved['args']['seed'], args.balanced_mixed)
    args.output.mkdir(parents=True, exist_ok=True)
    raw = args.output / 'games.jsonl'
    if raw.exists():
        raise ValueError('Refusing to overwrite evaluation evidence; choose a fresh output directory')
    manifest = {'checkpointSha256': hashlib.sha256(args.checkpoint.read_bytes()).hexdigest(),
                'checkpoint': str(args.checkpoint), 'firstSeed': args.first_seed, 'seeds': args.seeds,
                'games': len(configs), 'selection': 'greedy policy' if args.greedy else 'sampled policy', 'opponent': 'v1.5',
                'checkpointUpdates': saved['completed'], 'featureSchema': SCHEMA,
                'balancedMixedSchedule': args.balanced_mixed, 'featureEncoding': model.feature_encoding,
                'samplingVersion': SAMPLING_VERSION, 'checkpointSamplingVersion': saved.get('samplingVersion', 1)}
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    started = time.perf_counter()
    with raw.open('x') as stream:
        def record(result):
            stream.write(json.dumps(result) + '\n')
            stream.flush()
        _, games, batches = await collect(model, configs, args.workers, args.device, greedy=args.greedy, retain=False, on_result=record)
    model_games = [game for game in games if game['arm'] == 'model']
    fixtures = json.loads(subprocess.check_output(['node', str(pathlib.Path(__file__).with_name('diagnostics.mjs'))]))
    diagnostics = []
    for fixture in fixtures:
        state, actions = seat_memory(model.feature_encoding).encode(0, fixture['observation'])
        with torch.inference_mode():
            logits, _ = model(*batch([{'state': state, 'actions': actions}], args.device))
            probabilities = logits.softmax(-1)[0]
        chosen = int(probabilities.argmax())
        diagnostics.append({'name': fixture['name'], 'reversedHand': fixture['reversedHand'],
                            'preferredProbability': float(probabilities[fixture['preferred']].sum()),
                            'argmaxPreferred': chosen in fixture['preferred'],
                            'argmaxCandidate': fixture['observation']['candidates'][chosen]})
    report = {'manifest': manifest, 'seconds': time.perf_counter() - started,
              'team': summarize([game for game in model_games if game['mode'] == 'team']),
              'mixed': summarize([game for game in model_games if game['mode'] == 'mixed']),
              'mixedPaired': paired_mixed(games),
              'byLineup': {name: summarize([game for game in model_games if game['lineup'] == name]) for name in LINEUPS},
              'meanInferenceBatch': sum(batches) / max(1, len(batches)),
              'knownDiagnosticsNotHoldout': diagnostics}
    (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--checkpoint', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    # Explicit seed range prevents accidentally treating development as holdout.
    parser.add_argument('--first-seed', type=int, required=True)
    parser.add_argument('--seeds', type=int, required=True)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--threads', type=int, default=2)
    parser.add_argument('--device', default='cpu')
    parser.add_argument('--greedy', action='store_true', help='Evaluate argmax deployment; record separately from sampled policy')
    parser.add_argument('--balanced-mixed', action='store_true', help='Decouple sole-model seat from roster rotation over 18 seeds')
    asyncio.run(run(parser.parse_args()))
