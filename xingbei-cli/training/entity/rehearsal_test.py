import unittest

import torch

from model import EntityPolicy, Vocabulary, collate
from rehearsal import PolicyRehearsal


class RehearsalTest(unittest.TestCase):
    def test_masked_distillation_updates_actor_only(self):
        def token(kind, name):
            return dict(kind=kind, categorical={'name': name}, numbers={}, refs={})
        observations = [dict(schema='entities-v7', question=0,
            entities=[token('question', 'spellRebound')],
            candidates=[token('action', str(index)) for index in range(count)]) for count in (2, 3)]
        vocabulary = Vocabulary.fit(observations)
        model = EntityPolicy(len(vocabulary.symbols), width=8, layers=1)
        model.eval()
        with torch.no_grad():
            probabilities = model.policy_logits(collate(observations, vocabulary, 'cpu')).softmax(-1)
        rows = [dict(observation=observation, group='rebound', probabilities=probabilities[i, :len(observation['candidates'])].tolist())
                for i, observation in enumerate(observations)]
        rehearsal = PolicyRehearsal(rows, vocabulary)
        self.assertLess(abs(float(rehearsal.loss(model, 'cpu'))), 1e-6)
        with torch.no_grad():
            model.score[0].weight.add_(torch.randn_like(model.score[0].weight) * .5)
        loss = rehearsal.loss(model, 'cpu')
        self.assertTrue(torch.isfinite(loss))
        loss.backward()
        self.assertTrue(any(p.grad is not None and p.grad.abs().sum() > 0 for p in model.actor.parameters()))
        self.assertTrue(all(p.grad is None for p in model.critic.parameters()))
        self.assertTrue(all(p.grad is None for p in model.value.parameters()))


if __name__ == '__main__':
    unittest.main()
