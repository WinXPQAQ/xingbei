"""Frozen four-policy round robin, all legal decisions routed by seat."""
import argparse
import asyncio
import hashlib
import itertools
import json
from pathlib import Path
import time
import torch
from model import policy_from_checkpoint
from rollout import collect
from schedule import LINEUPS, TEAMS, roster
from evaluation_stats import summarize


def configs(first_seed, seeds, left, right):
    return [{'seed': seed, 'lineup': lineup, 'heroIds': roster(lineup, seed),
             'team': team, 'start': start, 'mode': 'team', 'samplingSeed': 211,
             'seatPolicies': [left if side == team else right for side in TEAMS]}
            for seed in range(first_seed, first_seed + seeds) for lineup in LINEUPS
            for team in ('red', 'blue') for start in (0, 1)]


async def run(args):
    protocol = json.loads(args.protocol.read_text())
    torch.set_num_threads(2)
    models, identities = {}, {}
    for name, entry in protocol['policies'].items():
        if not entry.get('checkpoint'):
            if name != 'v1.5':
                raise ValueError('Only frozen v1.5 is supported as deterministic opponent')
            identities[name] = entry
            continue
        path = Path(entry['checkpoint'])
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != entry['sha256']:
            raise ValueError('Checkpoint identity mismatch: ' + name)
        models[name] = policy_from_checkpoint(torch.load(path, map_location=args.device, weights_only=False), args.device)
        identities[name] = {**entry, 'verifiedSha256': digest}
    args.output.mkdir(parents=True, exist_ok=False)
    source = Path(__file__).resolve().parent.parent
    hashes = {str(path.relative_to(source)): hashlib.sha256(path.read_bytes()).hexdigest()
              for folder in ('src', 'training') for path in (source / folder).rglob('*')
              if path.is_file() and path.suffix in ('.js', '.mjs', '.py')}
    manifest = {**protocol, 'verifiedPolicies': identities, 'sourceHashes': hashes, 'selection': 'greedy', 'device': args.device}
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    report = {'scope': 'New development round robin; not independent 70% acceptance', 'pairs': [], 'matrix': {name: {} for name in identities}}
    started = time.monotonic()
    for left, right in itertools.combinations(identities, 2):
        schedule = configs(protocol['firstSeed'], protocol['seeds'], left, right)
        with (args.output / f'{left}-vs-{right}.jsonl').open('x') as stream:
            def record(result):
                stream.write(json.dumps(result)+'\n'); stream.flush()
            _, games, _ = await collect(next(iter(models.values())), schedule, args.workers, args.device,
                greedy=True, retain=False, on_result=record, actor_models=models)
        if len(games) != len(schedule) or len({(g['seed'],g['lineup'],g['team'],g['start']) for g in games}) != len(schedule):
            raise ValueError('Incomplete/duplicate league schedule')
        left_result = summarize(games)
        right_result = summarize([{**g, 'team': 'blue' if g['team']=='red' else 'red'} for g in games])
        entry = {'left': left, 'right': right, 'leftResult': left_result, 'rightResult': right_result,
                 'byLineup': {lineup: summarize([g for g in games if g['lineup']==lineup]) for lineup in LINEUPS}}
        report['pairs'].append(entry)
        report['matrix'][left][right] = left_result['resolvedWinRate']
        report['matrix'][right][left] = right_result['resolvedWinRate']
        report.update(state='running', seconds=time.monotonic()-started)
        (args.output/'progress.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(entry),flush=True)
    report.update(state='complete',seconds=time.monotonic()-started)
    (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')


if __name__ == '__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--protocol',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--device',default='cuda')
    p.add_argument('--workers',type=int,default=8)
    asyncio.run(run(p.parse_args()))
