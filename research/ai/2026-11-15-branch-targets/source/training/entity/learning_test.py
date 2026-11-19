"""Small contracts for training credit assignment and optimizer isolation."""
import copy
import unittest
import torch
from learning import training_samples, morale_potential, make_optimizers, restore_optimizers, parameter_groups, style_score, value_diagnostics, learner_sample_counts
from league import history_pool, opponent_weights
from model import EntityPolicy


class LearningTest(unittest.TestCase):
    def test_bounded_personalities_share_terminal_labels_and_keep_private_data_out(self):
        team = dict(start=dict(morale=12, cups=1, healing=0), end=dict(morale=12, cups=1, healing=0),
                    turns=3, attackDamage=0, healingSpent=0, holyLightBlocks=0)
        red, blue = copy.deepcopy(team), copy.deepcopy(team)
        red.update(attackDamage=6, healingSpent=2, holyLightBlocks=1)
        red['end'].update(cups=3, healing=1)
        blue['end']['morale'] = 6
        game = dict(terminated=True, truncated=False, rewards={'0': 1, '1': -1},
                    opponent='self', curriculumKind='full',
                    trajectory=[dict(seat=seat, old_value=0., learning=dict(requestId=1)) for seat in [0, 1]],
                    publicBehavior=dict(schema='team-behavior-v1', seats={'0': 'red', '1': 'blue'}, teams=dict(red=red, blue=blue)))
        vanilla = training_samples([game])
        self.assertEqual([row['return'] for row in vanilla], [1, -1])
        scores = [style_score(game, 0, style) for style in ['attack', 'cups', 'support']]
        self.assertEqual(len(set(scores)), 3)
        for style in ['attack', 'cups', 'support']:
            mc = training_samples([game], style=style, style_weight=.3)
            gae = training_samples([game], style=style, style_weight=.3, method='gae', trace_lambda=1)
            for row, bootstrapped in zip(mc, gae):
                self.assertLessEqual(abs(row['style_bonus']), .3)
                self.assertEqual(row['terminal_return'], game['rewards'][str(row['seat'])])
                self.assertAlmostEqual(row['return'], row['terminal_return']+row['style_bonus'])
                self.assertAlmostEqual(row['return'], bootstrapped['return'])
            diagnostics = value_diagnostics(mc)['full']
            self.assertEqual(diagnostics['value_semantics'], 'style_return')
            self.assertEqual(diagnostics['calibration'], [])
            self.assertEqual(learner_sample_counts(mc)['self']['samples'], 2)
        with self.assertRaises(ValueError):
            training_samples([game], style='win', style_weight=.3)
        with self.assertRaises(ValueError):
            training_samples([{**game, 'publicBehavior': {}}], style='attack', style_weight=.3)

    def test_team_returns_and_root_decisions(self):
        decisions = [dict(seat=0, old_value=0.2, learning=dict(requestId=root, ownMorale=own, enemyMorale=enemy))
                     for root, own, enemy in [(1, 8, 6), (1, 8, 6), (2, 6, 2)]]
        game = dict(terminated=True, truncated=False, rewards={'0': 1}, trajectory=decisions)
        mc = training_samples([game], morale_weight=0.2)
        gae = training_samples([game], method='gae', trace_lambda=1, morale_weight=0.2)
        for left, right in zip(mc, gae):
            self.assertAlmostEqual(left['return'], right['return'])
            self.assertAlmostEqual(left['return'], 1-0.2*morale_potential(left['learning']))
        gae = training_samples([game], method='gae', trace_lambda=0)
        self.assertAlmostEqual(gae[0]['advantage'], gae[1]['advantage'])
        self.assertEqual(training_samples([{**game, 'truncated': True}]), [])
        with self.assertRaises(ValueError):
            training_samples([{**game, 'learnerSeats': [1]}])
        own = dict(ownMorale=8, enemyMorale=2)
        self.assertAlmostEqual(morale_potential(own), -morale_potential(dict(ownMorale=2, enemyMorale=8)))

    def test_optimizer_migration_and_isolation(self):
        torch.manual_seed(7)
        model = EntityPolicy(12, width=8, layers=1)
        joint = torch.optim.AdamW(model.parameters(), lr=1e-4)
        sum(p.square().sum() for p in model.parameters()).backward()
        joint.step()
        saved = copy.deepcopy(joint.state_dict())
        split = make_optimizers(model)
        restore_optimizers(split, saved, model)
        for optimizer in split.values():
            for state in optimizer.state.values():
                self.assertEqual(state['step'].item(), 1)
        self.assertEqual(len(joint.state), sum(len(opt.state) for opt in split.values()))
        before = [p.detach().clone() for p in parameter_groups(model)['actor']]
        split['critic'].zero_grad()
        sum(p.square().sum() for p in parameter_groups(model)['critic']).backward()
        split['critic'].step()
        for actual, expected in zip(parameter_groups(model)['actor'], before):
            self.assertTrue(torch.equal(actual, expected))
        restored = make_optimizers(model)
        restore_optimizers(restored, {key:opt.state_dict() for key,opt in split.items()}, model)
        self.assertEqual(next(iter(restored['critic'].state.values()))['step'].item(), 2)

    def test_history_sampling_uses_full_archive(self):
        paths = list(map(str, range(320)))
        pool = history_pool(paths)
        self.assertEqual(len(pool), 8)
        self.assertEqual(pool[-1], '319')
        self.assertNotIn('1', pool)
        weights = opponent_weights(pool, {pool[0]: dict(games=100, wins=0), pool[-1]: dict(games=100, wins=100)})
        self.assertAlmostEqual(sum(weights), 1)
        self.assertGreater(weights[0], weights[-1])
        self.assertTrue(all(weight >= .2/8 for weight in weights))


if __name__ == '__main__':
    unittest.main()
