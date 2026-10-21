"""Explain sampled decision departures without accessing simulator hidden state."""
import argparse
import asyncio
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import torch
from model import policy_from_checkpoint
from rollout import collect
from schedule import training_configs

async def run(args):
    torch.set_num_threads(2)
    saved = torch.load(args.checkpoint, map_location='cuda', weights_only=False)
    model = policy_from_checkpoint(saved, 'cuda')
    counts, departures, turns = Counter(), [], Counter()
    def record(observation, row):
        hero, kind = observation['players'][0]['hero'], row['kind']
        counts[(hero, kind)] += 1
        turns[(row['seed'], row['seat'])] += 1
        if row['choice'] == row['baselineChoice']:
            return
        departures.append({'seed': row['seed'], 'seat': row['seat'], 'decision': turns[(row['seed'], row['seat'])],
                           'hero': hero, 'kind': kind, 'request': observation['request'],
                           'hand': observation['players'][0]['hand'],
                           'baseline': observation['candidates'][row['baselineChoice']],
                           'chosen': observation['candidates'][row['choice']]})
    configs = training_configs(251600000, 0, 24, 211, False)
    _, games, _ = await collect(model, configs, 4, 'cuda', greedy=True, retain=False, on_choice=record)
    grouped = defaultdict(list)
    for entry in sorted(departures, key=lambda d: (d['seed'], d['seat'], d['decision'])):
        grouped[(entry['hero'], entry['kind'])].append(entry)
    report = {'checkpoint':str(args.checkpoint), 'sha256':hashlib.sha256(args.checkpoint.read_bytes()).hexdigest(),
              'firstSeed':251600000, 'games':len(games), 'truncated':sum(g['truncated'] for g in games),
              'scope':'Greedy on training-range games; groups count decisions, not independent samples. First three departures per hero/kind retained in seed/seat/order order; no outcome selection. Not a counterfactual benefit estimate.',
              'groups':[{'hero':h, 'kind':k, 'decisions':count, 'departures':len(grouped[(h,k)]),
                         'examples':grouped[(h,k)][:3]} for (h,k),count in sorted(counts.items())]}
    with args.output.open('x') as stream:
        json.dump(report, stream, indent=2)
    print(json.dumps({'decisions':sum(counts.values()),'departures':len(departures),'truncated':report['truncated']}))

if __name__ == '__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--checkpoint',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    asyncio.run(run(p.parse_args()))
