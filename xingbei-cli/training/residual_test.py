import asyncio
import unittest

import torch
from model import Policy, batch, policy_from_checkpoint, load_policy_state, SCHEMA, STATE_DIM, ACTION_DIM
from model_test import observation
from encoding_candidate import seat_memory
from rollout import collect


class ResidualTests(unittest.TestCase):
    def test_comparison_upgrade_preserves_parent_and_roundtrips(self):
        torch.set_num_threads(1)
        torch.manual_seed(82)
        parent = Policy(feature_encoding='decision-context-v6', separate_critic=True, baseline_version='v1.5')
        parent_rng = torch.get_rng_state().clone()
        torch.manual_seed(82)
        Policy(feature_encoding='decision-context-v6', separate_critic=True,
               baseline_version='v1.5', comparison_head=True)
        self.assertTrue(torch.equal(parent_rng, torch.get_rng_state()))
        # Nonzero trained-like actor: equality must not rely on zero residuals.
        with torch.no_grad():
            parent.action[-2].weight.normal_(0, .03)
        saved = {'schema': SCHEMA, 'featureEncoding': parent.feature_encoding,
                 'model': parent.state_dict(), 'separateCritic': True,
                 'baselineVersion': 'v1.5', 'baselineProbability': .95}
        model = Policy(feature_encoding=parent.feature_encoding, separate_critic=True,
                       baseline_version='v1.5', comparison_head=True)
        with self.assertRaises(ValueError):
            load_policy_state(model, saved)
        load_policy_state(model, saved, allow_comparison_upgrade=True)
        states = torch.randn(2, STATE_DIM * 2)
        actions = torch.randn(2, 5, ACTION_DIM)
        mask = torch.tensor([[True] * 5, [True, True, True, False, False]])
        baseline = torch.tensor([3, 1])
        inputs = (states, actions, mask, baseline)
        for a, b in zip(parent(*inputs), model(*inputs)):
            self.assertTrue(torch.equal(a, b))
        optimizer = torch.optim.Adam(model.parameters(), lr=.001)
        loss = -model(*inputs)[0].log_softmax(-1)[:, 0].mean()
        loss.backward()
        self.assertGreater(model.comparison['output'].weight.grad.abs().sum().item(), 0)
        optimizer.step()
        expected = model(*inputs)[0]
        self.assertTrue(torch.isneginf(expected[1, 3:]).all())
        restored = policy_from_checkpoint({**saved, 'comparisonHead': True, 'model': model.state_dict()})
        self.assertTrue(torch.equal(expected, restored(*inputs)[0]))
        # Candidate permutation including padding must only permute scores.
        order = torch.tensor([2, 0, 4, 1, 3])
        remapped = torch.argsort(order)[baseline]
        actual = model(states, actions[:, order], mask[:, order], remapped)[0]
        torch.testing.assert_close(actual, expected[:, order], atol=1e-6, rtol=1e-6)
        with self.assertRaises(ValueError):
            load_policy_state(parent, {**saved, 'comparisonHead': True, 'model': model.state_dict()})

    def test_zero_adjustment_exact_and_exploration_independent_of_width(self):
        torch.set_num_threads(1)
        model = Policy(feature_encoding='decision-context-v6', separate_critic=True, baseline_version='v1.5')
        state, actions = seat_memory(model.feature_encoding).encode(0, observation())
        rows = [{'state': state, 'actions': actions.repeat(n, 1), 'baselineChoice': n} for n in (1, 4, 20)]
        logits, _ = model(*batch(rows, 'cpu'))
        self.assertEqual(logits.argmax(-1).tolist(), [1, 4, 20])
        for i, row in enumerate(rows):
            self.assertAlmostEqual(logits.softmax(-1)[i, row['baselineChoice']].item(), .95, places=5)
        with self.assertRaises(ValueError):
            model(*batch([{'state': state, 'actions': actions}], 'cpu'))
        saved = {'schema': SCHEMA, 'featureEncoding': model.feature_encoding, 'model': model.state_dict(),
                 'separateCritic': True, 'baselineVersion': 'v1.5', 'baselineProbability': .95}
        restored = policy_from_checkpoint(saved, 'cpu')
        self.assertTrue(torch.equal(logits, restored(*batch(rows, 'cpu'))[0]))
        # The correction has gradients at initialization and can override the baseline.
        optimizer = torch.optim.Adam(model.parameters(), lr=.01)
        for _ in range(12):
            score, _ = model(*batch(rows[:1], 'cpu'))
            loss = -score.log_softmax(-1)[0, 0]
            optimizer.zero_grad(); loss.backward(); optimizer.step()
        self.assertEqual(model(*batch(rows[:1], 'cpu'))[0].argmax(-1).item(), 0)

    def test_complete_game_initialization_matches_v15_decision_by_decision(self):
        torch.set_num_threads(1)
        model = Policy(feature_encoding='decision-context-v6', separate_critic=True, baseline_version='v1.5')
        configs = [{'seed': 251000000 + i, 'start': i} for i in range(6)]
        rows, games, _ = asyncio.run(collect(model, configs, 3, 'cpu', teacher='v1.5', execute_teacher=False, greedy=True))
        self.assertTrue(rows)
        self.assertTrue(all(row['choice'] == row['baselineChoice'] == row['teacherChoice'] for row in rows))
        self.assertTrue(all(game['terminated'] for game in games))
        _, controls, _ = asyncio.run(collect(model, [{**c, 'seatPolicies': ['v1.5'] * 6} for c in configs], 3, 'cpu', retain=False))
        for game, control in zip(games, controls):
            for key in ('winner', 'turns', 'decisions', 'kinds'):
                self.assertEqual(game[key], control[key])


if __name__ == '__main__':
    unittest.main()
