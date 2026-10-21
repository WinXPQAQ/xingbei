"""Teacher queries must neither execute actions nor alter model trajectories."""
import asyncio
import unittest

import torch
from model import Policy
from rollout import collect
from schedule import training_configs


class TeacherIsolationTests(unittest.TestCase):
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
