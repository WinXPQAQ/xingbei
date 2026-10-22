import unittest
import copy
import hashlib
import json
from collections import Counter
from evaluation_breakdown import audit_schedule, breakdown
from schedule import evaluation_configs, training_configs, TEAMS, DEFAULT
from evaluation_stats import summarize, paired_mixed


class EvaluationTests(unittest.TestCase):
    def test_focused_curriculum_preserves_legacy_and_coverage(self):
        legacy = [training_configs(252300000, i, 24, 211, False) for i in range(7)]
        self.assertEqual(hashlib.sha256(json.dumps(legacy, sort_keys=True).encode()).hexdigest(),
                         'd5daab776dcec6dff26a1d1ed76c8468697b752031551a5ca277cfc6ea3128ee')
        focused = [training_configs(252300000, i, 24, 211, False, 'v15-focused') for i in range(7)]
        for old, new in zip(legacy, focused):
            self.assertEqual(Counter(g['seatPolicies'].count('model') for g in new), {3: 16, 6: 4, 1: 4})
            self.assertEqual(Counter(TEAMS[g['seatPolicies'].index('model')] for g in new
                                     if g['seatPolicies'].count('model') == 3), {'red': 8, 'blue': 8})
            for a, b in zip(old, new):
                self.assertEqual({k:v for k,v in a.items() if k != 'seatPolicies'},
                                 {k:v for k,v in b.items() if k != 'seatPolicies'})
                if b['seatPolicies'].count('model') == 3:
                    self.assertEqual(set(b['seatPolicies']), {'model', 'v1.5'})
        self.assertEqual({g['start'] for group in focused for g in group}, set(range(6)))
        self.assertEqual({h for group in focused for g in group for h in g['heroIds']}, set(DEFAULT))
        for team in ('red', 'blue'):
            self.assertEqual({g['seatPolicies'].index('model') for group in focused for g in group
                              if g['seatPolicies'].count('model') == 1
                              and TEAMS[g['seatPolicies'].index('model')] == team},
                             {i for i,t in enumerate(TEAMS) if t == team})
        with self.assertRaises(ValueError):
            training_configs(1, 0, 24, 211, False, 'unknown')

    def test_breakdown_audits_actual_rosters_policies_and_complete_pairs(self):
        configs = evaluation_configs(231000000, 1, 211, True)
        games = [{**c, 'winner': 'red', 'terminated': True, 'truncated': False} for c in configs]
        manifest = {'firstSeed': 231000000, 'seeds': 1, 'games': len(games), 'balancedMixedSchedule': True}
        self.assertTrue(audit_schedule(games, manifest, 211))
        for field, value in [('heroIds', ['berserker'] * 6), ('seatPolicies', ['model'] * 6), ('winner', None)]:
            bad = copy.deepcopy(games); bad[0][field] = value
            with self.assertRaises(ValueError):
                audit_schedule(bad, manifest, 211)
        with self.assertRaises(ValueError):
            audit_schedule(games[:-1] + games[:1], manifest, 211)
        report = breakdown(games)
        self.assertEqual(report['team']['overall']['games'], 28)
        self.assertEqual(report['mixed']['overall']['games'], 28)
        self.assertEqual(sum(v['teamOutcomeWithThisSoleModelHero']['games'] for v in report['bySoleModelHero'].values()), 28)
        self.assertEqual(report['mixedPaired']['pairs'], 28)

    def test_balanced_mixed_covers_every_hero_on_both_teams(self):
        configs = evaluation_configs(241000000, 18, 211, balanced_mixed=True)
        for team in ('red', 'blue'):
            heroes = {game['heroIds'][game['seatPolicies'].index('model')] for game in configs
                      if game['mode'] == 'mixed' and game['arm'] == 'model'
                      and game['lineup'] == 'default' and game['team'] == team}
            self.assertEqual(heroes, set(DEFAULT))

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
