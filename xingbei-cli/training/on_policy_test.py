"""Teacher queries must neither execute actions nor alter model trajectories."""
import asyncio
import unittest

import torch
from model import Policy
from rollout import collect, sample_legal
from schedule import training_configs


class TeacherIsolationTests(unittest.TestCase):
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
            labelled, labelled_games, _ = await collect(model, configs, 2, 'cpu', teacher='v1.5',
                                                       execute_teacher=False, greedy=True)
            self.assertEqual(plain_games, labelled_games)
            self.assertTrue(all(game['terminated'] for game in plain_games))
            self.assertTrue(all(row['choice'] == 0 for row in labelled))
            self.assertTrue(any(row['teacherChoice'] != row['choice'] for row in labelled))
            self.assertEqual([row['choice'] for row in plain], [row['choice'] for row in labelled])
        asyncio.run(verify())


if __name__ == '__main__':
    unittest.main()
