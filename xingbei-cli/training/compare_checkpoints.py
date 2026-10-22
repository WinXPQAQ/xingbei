"""Paired development comparison; candidate scenarios must all exist in baseline."""
import argparse
import json
from pathlib import Path
import random

parser = argparse.ArgumentParser()
parser.add_argument('--baseline', type=Path, required=True)
parser.add_argument('--candidate', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()

def read(directory):
    rows = [json.loads(line) for line in (directory / 'games.jsonl').read_text().splitlines()]
    manifest = json.loads((directory / 'manifest.json').read_text())
    if len(rows) != manifest['games'] or not (directory / 'report.json').exists():
        raise ValueError('Incomplete evaluation evidence')
    rows = [row for row in rows if row['arm'] == 'model']
    keys = [(row['seed'], row['lineup'], row['team'], row['start'], row['mode']) for row in rows]
    if len(keys) != len(set(keys)):
        raise ValueError('Duplicate scenario')
    return dict(zip(keys, rows))

baseline_manifest = json.loads((args.baseline / 'manifest.json').read_text())
candidate_manifest = json.loads((args.candidate / 'manifest.json').read_text())
if baseline_manifest.get('rulesVersion') != candidate_manifest.get('rulesVersion'):
    raise ValueError('Cannot compare different rule versions; reevaluate the baseline')
baseline, candidate = read(args.baseline), read(args.candidate)
if not candidate or not candidate.keys() <= baseline.keys():
    raise ValueError('Candidate scenarios are missing from baseline')
results = {}
for mode in ('team', 'mixed'):
    groups = {}
    wins = [0, 0]
    for key, game in candidate.items():
        if game['mode'] != mode:
            continue
        parent = baseline[key]
        for field in ('heroIds', 'seatPolicies', 'samplingSeed'):
            if game[field] != parent[field]:
                raise ValueError('Unpaired scenario field: ' + field)
        if game['truncated'] or parent['truncated']:
            raise ValueError('Unresolved pair: report truncation before interpreting strength')
        a, b = int(parent['winner'] == parent['team']), int(game['winner'] == game['team'])
        wins[0] += a
        wins[1] += b
        groups.setdefault(game['seed'], []).append(b - a)
    values = [sum(group) / len(group) for group in groups.values()]
    if not values:
        continue
    rng = random.Random(99371)
    samples = sorted(sum(rng.choice(values) for _ in values) / len(values) for _ in range(4000))
    results[mode] = {'pairedGames': sum(map(len, groups.values())), 'seedClusters': len(groups),
                     'baselineWins': wins[0], 'candidateWins': wins[1],
                     'meanWinRateDifference': sum(values) / len(values),
                     'seedCluster95': [samples[100], samples[3899]] if len(values) > 1 else None}
report = {'baseline': str(args.baseline), 'candidate': str(args.candidate),
          'scope': 'paired development comparison, not final acceptance', 'results': results}
args.output.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
