import unittest
from schedule import evaluation_configs, training_configs, TEAMS, DEFAULT
from evaluation_stats import summarize, paired_mixed


class EvaluationTests(unittest.TestCase):
    def test_schedule_keeps_all_heroes_and_paired_arms(self):
        configs = evaluation_configs(240000000, 2, 41)
        self.assertEqual(len(configs), 168)
        pairs = {}
        for config in configs:
            self.assertEqual(len(config['heroIds']), 6)
            if config['mode'] == 'mixed':
                key = (config['seed'], config['lineup'], config['team'], config['start'])
                pairs.setdefault(key, []).append(config)
                if config['arm'] == 'model':
                    self.assertEqual(config['seatPolicies'].count('model'), 1)
            else:
                self.assertEqual(config['seatPolicies'].count('model'), 3)
        for pair in pairs.values():
            self.assertEqual({config['arm'] for config in pair}, {'model', 'control'})
            self.assertEqual(pair[0]['heroIds'], pair[1]['heroIds'])
        training = training_configs(220000000, 0, 42, 41, False)
        self.assertEqual(set(hero for config in training for hero in config['heroIds']), set(DEFAULT))
        self.assertEqual({config['seatPolicies'].count('model') for config in training}, {1, 3, 6})
        for config in training:
            for seat, policy in enumerate(config['seatPolicies']):
                if policy == 'model' and config['seatPolicies'].count('model') == 1:
                    self.assertTrue(all(config['seatPolicies'][other] != 'model' for other in range(6) if other != seat and TEAMS[other] == TEAMS[seat]))

    def test_truncations_are_unknown_and_pairs_are_validated(self):
        games = [dict(seed=1, team='red', winner='red', truncated=False),
                 dict(seed=1, team='red', winner=None, truncated=True)]
        summary = summarize(games)
        self.assertEqual(summary['allGameWinRateBounds'], [0.5, 1.0])
        self.assertEqual(summary['losses'], 0)
        self.assertEqual(summary['truncated'], 1)
        self.assertIsNone(summary['seedCluster95'])
        pair = [{**game, 'lineup': 'default', 'start': 0, 'mode': 'mixed', 'arm': arm} for game, arm in zip(games, ['model', 'control'])]
        self.assertEqual(paired_mixed(pair)['unresolvedPairs'], 1)
        self.assertFalse(paired_mixed(pair)['confirmatory'])
        with self.assertRaises(ValueError):
            paired_mixed(pair[:1])


if __name__ == '__main__':
    unittest.main()
