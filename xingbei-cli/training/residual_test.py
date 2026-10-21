import asyncio
import unittest

import torch
from model import Policy, batch, policy_from_checkpoint, SCHEMA
from model_test import observation
from encoding_candidate import seat_memory
from rollout import collect


class ResidualTests(unittest.TestCase):
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
