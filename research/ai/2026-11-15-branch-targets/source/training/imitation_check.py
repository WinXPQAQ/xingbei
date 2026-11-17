"""Measure teacher agreement on separate demonstration games, not playing strength."""
import argparse
import asyncio
import json
from pathlib import Path

import torch
from model import policy_from_checkpoint, Policy, SCHEMA, batch
from rollout import collect
from schedule import training_configs


async def run(args):
    torch.set_num_threads(2)
    saved = torch.load(args.checkpoint, map_location=args.device, weights_only=False)
    if saved['schema'] != SCHEMA:
        raise ValueError('Feature schema mismatch')
    model = policy_from_checkpoint(saved, args.device)
    rows, games, _ = await collect(model, training_configs(args.first_seed, 0, args.games, 997, not args.on_policy),
                                   args.workers, args.device, teacher='v1.5',
                                   execute_teacher=not args.on_policy, greedy=args.on_policy)
    totals = {}
    model.eval()
    with torch.inference_mode():
        for offset in range(0, len(rows), 64):
            part = rows[offset:offset + 64]
            logits, _ = model(*batch(part, args.device))
            probabilities = logits.softmax(-1)
            for index, row in enumerate(part):
                # Forced choices do not demonstrate learned decision quality.
                if len(row['actions']) == 1:
                    continue
                for key in ('all', row['kind']):
                    item = totals.setdefault(key, {'count': 0, 'correct': 0, 'teacherProbability': 0})
                    item['count'] += 1
                    label = row.get('teacherChoice', row['choice'])
                    item['correct'] += int(logits[index].argmax().item() == label)
                    item['teacherProbability'] += probabilities[index, label].item()
    for item in totals.values():
        item['accuracy'] = item['correct'] / item['count']
        item['teacherProbability'] /= item['count']
    report = {'checkpoint': str(args.checkpoint), 'firstSeed': args.first_seed,
              'games': len(games), 'truncated': sum(game['truncated'] for game in games),
              'nonForcedTeacherAgreement': totals, 'notWinRate': True,
              'execution': 'model-greedy with training opponent mix; teacher labels only' if args.on_policy else 'teacher-forced'}
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--first-seed', type=int, required=True)
    parser.add_argument('--games', type=int, default=48)
    parser.add_argument('--workers', type=int, default=8)
    parser.add_argument('--device', default='cuda')
    parser.add_argument('--on-policy', action='store_true')
    asyncio.run(run(parser.parse_args()))
