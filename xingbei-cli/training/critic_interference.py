"""Measure policy drift from critic-only updates; this is not a playing-strength test."""
import argparse
import asyncio
import json
from pathlib import Path

import torch
from model import policy_from_checkpoint, Policy, batch
from rollout import collect
from schedule import training_configs

parser = argparse.ArgumentParser()
parser.add_argument('--checkpoint', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()

async def run():
    torch.set_num_threads(2)
    torch.manual_seed(811)
    saved = torch.load(args.checkpoint, map_location='cuda', weights_only=False)
    model = policy_from_checkpoint(saved, 'cuda')
    rows, games, _ = await collect(model, training_configs(210050000, 0, 24, 811, False), 2, 'cuda')
    parts = [rows[offset:offset + 64] for offset in range(0, len(rows), 64)]
    before = []
    with torch.inference_mode():
        for part in parts:
            logits, _ = model(*batch(part, 'cuda'))
            before.append(logits.log_softmax(-1).cpu())
    optimizer = torch.optim.Adam(model.parameters(), lr=3e-4)
    optimizer.load_state_dict(saved['optimizer'])
    losses = []
    for _ in range(3):
        order = torch.randperm(len(rows)).tolist()
        for offset in range(0, len(rows), 128):
            part = [rows[index] for index in order[offset:offset + 128]]
            _, values = model(*batch(part, 'cuda'))
            returns = torch.tensor([row['return'] for row in part], device='cuda', dtype=torch.float32)
            loss = 0.5 * (values - returns).square().mean()
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            losses.append(loss.item())
    changed, nonforced, total_kl = 0, 0, 0.0
    with torch.inference_mode():
        for part, old in zip(parts, before):
            logits, _ = model(*batch(part, 'cuda'))
            new = logits.log_softmax(-1).cpu()
            for index, row in enumerate(part):
                count = len(row['actions'])
                if count <= 1:
                    continue
                a, b = old[index, :count], new[index, :count]
                nonforced += 1
                changed += int(a.argmax() != b.argmax())
                total_kl += (a.exp() * (a - b)).sum().item()
    report = {'checkpoint': str(args.checkpoint), 'games': len(games), 'rows': len(rows),
              'truncated': sum(game['truncated'] for game in games), 'nonForcedDecisions': nonforced,
              'argmaxChanged': changed, 'argmaxChangeRate': changed / nonforced,
              'meanPolicyKLFromCriticOnly': total_kl / nonforced,
              'meanCriticLoss': sum(losses) / len(losses), 'epochs': 3,
              'scope': 'critic-only diagnostic using inherited Adam state; not a policy optimization or win-rate result'}
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))

asyncio.run(run())
