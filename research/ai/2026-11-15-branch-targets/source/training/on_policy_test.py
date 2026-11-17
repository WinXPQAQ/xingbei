"""Teacher queries must neither execute actions nor alter model trajectories."""
import asyncio
import unittest

import torch
from model import Policy, batch
from rollout import collect, sample_legal
from schedule import training_configs
from train import update


class TeacherIsolationTests(unittest.TestCase):
    def test_temperature_sampling_and_ppo_use_same_probabilities(self):
        async def verify():
            torch.set_num_threads(1)
            torch.manual_seed(73)
            model = Policy(feature_encoding='decision-context-v6', separate_critic=True,
                           baseline_version='v1.5')
            configs = training_configs(251800000, 0, 2, 211, False)
            rows, games, _ = await collect(model, configs, 2, 'cpu', temperature=1.3)
            self.assertTrue(all(game['terminated'] for game in games))
            self.assertTrue(all(row['temperature'] == 1.3 for row in rows))
            with torch.no_grad():
                for offset in range(0, len(rows), 64):
                    part = rows[offset:offset + 64]
                    logits, _ = model(*batch(part, 'cpu'))
                    distribution = torch.distributions.Categorical(logits=logits / 1.3)
                    expected = distribution.log_prob(torch.tensor([r['choice'] for r in part]))
                    torch.testing.assert_close(expected, torch.tensor([r['logp'] for r in part]), atol=1e-5, rtol=1e-5)
                    self.assertTrue(torch.equal(logits.argmax(-1), (logits / 1.3).argmax(-1)))
            diagnostic = {}
            update(model, torch.optim.Adam(model.parameters(), lr=0), rows, 'cpu',
                   imitation=False, epochs=1, diagnostics=diagnostic)
            self.assertLess(abs(diagnostic['approximateKL']), 1e-6)
            self.assertEqual(diagnostic['clipFraction'], 0)
            for temperature in (0, -1, float('nan'), float('inf')):
                with self.assertRaises(ValueError):
                    await collect(model, [], 1, 'cpu', temperature=temperature)
        asyncio.run(verify())

    def test_padding_cannot_change_sampling_stream(self):
        def sequence(width):
            generator = torch.Generator().manual_seed(211)
            probabilities = torch.tensor([0.3, 0.7] + [0.0] * (width - 2))
            return [sample_legal(probabilities, 2, generator) for _ in range(20)]
        self.assertEqual(sequence(2), sequence(7))
        self.assertEqual(sequence(2), sequence(20))

    def test_uniform_sampled_games_are_invariant_to_worker_count(self):
        async def verify():
            torch.set_num_threads(1)
            model = Policy()
            for parameter in model.parameters():
                parameter.data.zero_()
            configs = training_configs(210041000, 0, 6, 919, True)
            _, serial, _ = await collect(model, configs, 1, 'cpu', retain=False)
            _, parallel, _ = await collect(model, configs, 3, 'cpu', retain=False)
            self.assertEqual(serial, parallel)
            self.assertTrue(all(game['terminated'] for game in serial))
        asyncio.run(verify())

    def test_label_only_teacher_preserves_actual_model_game(self):
        async def verify():
            torch.set_num_threads(1)
            model = Policy()
            for parameter in model.parameters():
                parameter.data.zero_()
            configs = training_configs(210040000, 0, 2, 911, True)
            plain, plain_games, _ = await collect(model, configs, 2, 'cpu', greedy=True)
            observed = []
            labelled, labelled_games, _ = await collect(model, configs, 2, 'cpu', teacher='v1.5',
                                                       execute_teacher=False, greedy=True,
                                                       on_choice=lambda observation, row: observed.append((observation['request']['type'], row['choice'])))
            self.assertEqual(plain_games, labelled_games)
            self.assertEqual(len(observed), len(labelled))
            self.assertTrue(all(choice == 0 for _, choice in observed))
            self.assertTrue(all(game['terminated'] for game in plain_games))
            self.assertTrue(all(row['choice'] == 0 for row in labelled))
            self.assertTrue(any(row['teacherChoice'] != row['choice'] for row in labelled))
            self.assertEqual([row['choice'] for row in plain], [row['choice'] for row in labelled])
        asyncio.run(verify())


if __name__ == '__main__':
    unittest.main()
