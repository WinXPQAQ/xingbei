"""Actor-only rehearsal of a saved policy on separately collected skill states.

The teacher distribution is stored with each observation. No practice reward or
practice value target enters the full-game critic. Deployment uses one policy.
"""
import random

import torch

from prepared import PreparedObservations


class PolicyRehearsal:
    def __init__(self, examples, vocabulary):
        if not examples:
            raise ValueError('Rehearsal requires skill observations')
        self.examples = examples
        self.random = random.Random(20261114)
        self.prepared = PreparedObservations([row['observation'] for row in examples], vocabulary)
        self.groups = {}
        for row in examples:
            probabilities = torch.as_tensor(row['probabilities'])
            if (probabilities.ndim != 1 or len(probabilities) < 2
                    or not torch.isfinite(probabilities).all()
                    or (probabilities < 0).any()
                    or abs(float(probabilities.sum()) - 1) > 1e-5):
                raise ValueError('Invalid rehearsal policy distribution')
            self.groups.setdefault(row['group'], []).append(row)
        self.groups = list(self.groups.values())

    def loss(self, model, device, count=16):
        selected = [self.random.choice(self.random.choice(self.groups)) for _ in range(count)]
        batch = self.prepared.collate([row['observation'] for row in selected], device)
        logits = model.policy_logits(batch)
        probabilities = torch.zeros_like(logits)
        for index, row in enumerate(selected):
            values = torch.as_tensor(row['probabilities'], device=device)
            if values.numel() != int(torch.isfinite(logits[index]).sum()):
                raise ValueError('Rehearsal candidate ordering/count changed')
            probabilities[index, :values.numel()] = values
        log_probabilities = logits.log_softmax(-1).masked_fill(~torch.isfinite(logits), 0)
        divergence = probabilities * (probabilities.clamp_min(1e-30).log() - log_probabilities)
        return divergence.sum(-1).mean()
