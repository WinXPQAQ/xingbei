"""Pretraining equivalence audit; never counts as evidence of learned strength."""
import asyncio
import json
import pathlib
import sys
import torch
from model import Policy
from rollout import collect
from schedule import LINEUPS, roster

async def run():
    torch.set_num_threads(2)
    model = Policy(feature_encoding='decision-context-v6', separate_critic=True, baseline_version='v1.5').to('cuda')
    configs = [{'seed': 251001000 + i * 6 + seat, 'start': seat, 'heroIds': roster(name, seat)}
               for i, name in enumerate(LINEUPS) for seat in range(6)]
    rows, games, _ = await collect(model, configs, 4, 'cuda', teacher='v1.5', execute_teacher=False, greedy=True)
    _, controls, _ = await collect(model, [{**c, 'seatPolicies': ['v1.5'] * 6} for c in configs], 4, 'cuda', retain=False)
    mismatches = sum(row['choice'] != row['teacherChoice'] or row['choice'] != row['baselineChoice'] for row in rows)
    game_differences = [a['seed'] for a, b in zip(games, controls) if any(a[key] != b[key] for key in ('winner', 'turns', 'decisions', 'kinds'))]
    report = {'games': len(games), 'decisions': len(rows), 'decisionMismatches': mismatches,
              'gameDifferences': game_differences, 'truncated': sum(g['truncated'] for g in games),
              'scope': 'zero correction, greedy GPU; seven lineups, six starts; not a strength evaluation', 'results': games}
    with pathlib.Path(sys.argv[1]).open('x') as stream:
        json.dump(report, stream, indent=2)
    assert not mismatches and not game_differences and not report['truncated']
    print(json.dumps({k:v for k,v in report.items() if k != 'results'}))

asyncio.run(run())
