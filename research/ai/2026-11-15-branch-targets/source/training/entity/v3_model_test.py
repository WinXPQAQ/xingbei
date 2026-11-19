import io
import unittest

import torch

from learning import parameter_groups
from model import EntityPolicy, SCHEMA, Vocabulary, collate, pack_observation, prepare_observation


def observation(hero, ordinary):
    def token(kind, action):
        return dict(kind=kind, categorical={'type': action}, numbers={}, refs={})
    names = ('attack', 'spell', 'refine')
    return dict(schema=SCHEMA, question=0, entities=[token('question', 'action')],
                candidates=[token('candidate', name) for name in names[:len(ordinary)]],
                v3={'hero': hero, 'ordinary': ordinary})


class V3PolicyTests(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(1)
        torch.manual_seed(77)
        self.sage = observation('sage', [True, True, False])
        self.other = observation('marksman', [True, True, False])
        self.vocabulary = Vocabulary.fit([self.sage, self.other])
        self.policy = EntityPolicy(len(self.vocabulary.symbols), width=16, layers=1)
        self.batch = collate([self.sage, self.other], self.vocabulary)

    def test_v2_warm_start_and_v3_round_trip(self):
        before = self.policy.policy_logits(self.batch)
        self.policy.enable_v3()
        torch.testing.assert_close(self.policy.policy_logits(self.batch), before, rtol=0, atol=0)
        self.policy.set_v3_phase('sage')
        with torch.no_grad():
            self.policy.v3_sage_score[-1].bias.add_(1.5)
        saved = io.BytesIO()
        torch.save(self.policy.checkpoint(self.vocabulary), saved)
        saved.seek(0)
        policy, vocabulary = EntityPolicy.restore(torch.load(saved, weights_only=True))
        self.assertEqual(policy.v3_phase, 'sage')
        self.assertEqual(vocabulary.symbols, self.vocabulary.symbols)
        torch.testing.assert_close(policy.policy_logits(self.batch), self.policy.policy_logits(self.batch))

    def test_mixed_roots_preserve_exclusive_scores_and_ordinary_mass(self):
        self.policy.enable_v3()
        before = self.policy.policy_logits(self.batch)
        with torch.no_grad():
            self.policy.score[0].weight.zero_()
        after = self.policy.policy_logits(self.batch)
        torch.testing.assert_close(after[:, -1], before[:, -1], rtol=0, atol=0)
        torch.testing.assert_close(after[:, :2].logsumexp(1), before[:, :2].logsumexp(1))
        self.assertFalse(torch.equal(before[:, :2], after[:, :2]))
        self.policy.set_v3_phase('sage')
        with torch.no_grad():
            self.policy.v3_sage_score[-1].bias.add_(2.0)
        hero_change = self.policy.policy_logits(self.batch)
        torch.testing.assert_close(hero_change[0], after[0] + 2.0)
        torch.testing.assert_close(hero_change[1], after[1], rtol=0, atol=0)

    def test_phase_optimizers_and_exclusive_gradient(self):
        self.policy.enable_v3()
        groups = parameter_groups(self.policy)
        self.assertEqual(list(map(id, groups['actor'])), list(map(id, self.policy.score.parameters())))
        self.policy.policy_logits(self.batch)[:, -1].sum().backward()
        for parameter in groups['actor']:
            torch.testing.assert_close(parameter.grad, torch.zeros_like(parameter))
        self.assertFalse(any(parameter.requires_grad for parameter in self.policy.actor.parameters()))
        self.assertFalse(any(parameter.requires_grad for parameter in self.policy.v3_reference_score.parameters()))
        self.policy.set_v3_phase('sage')
        groups = parameter_groups(self.policy)
        self.assertEqual(list(map(id, groups['actor'])), list(map(id, self.policy.v3_sage_score.parameters())))
        self.policy.policy_logits(self.batch)[0].sum().backward()
        self.assertTrue(any(torch.count_nonzero(parameter.grad) for parameter in groups['actor']))

    def test_routing_stays_with_padded_binary_and_sparse_candidates(self):
        short = observation('marksman', [False])
        plain = {name: value for name, value in short.items() if name != 'v3'}
        binary = dict(schema=SCHEMA, wire='tensor-v1', vocabulary=self.vocabulary.digest,
                      action_count=1, tensors=prepare_observation(plain, self.vocabulary), v3=short['v3'])
        sparse = pack_observation(self.sage, self.vocabulary)
        batch = collate([sparse, binary], self.vocabulary)
        self.assertEqual(batch['v3_ordinary'].tolist(), [[True, True, False], [False, False, False]])
        self.assertEqual(batch['v3_sage'].tolist(), [True, False])
        self.policy.enable_v3()
        scores = self.policy.policy_logits(batch)
        self.assertTrue(torch.isfinite(scores[1][0]))
        self.assertTrue(torch.isneginf(scores[1][1:]).all())
        with self.assertRaisesRegex(ValueError, 'routing missing'):
            collate([sparse, {**binary, 'v3': None}], self.vocabulary)
        with self.assertRaisesRegex(ValueError, 'explicit decision routing'):
            self.policy.policy_logits(collate([plain], self.vocabulary))


if __name__ == '__main__':
    unittest.main()
