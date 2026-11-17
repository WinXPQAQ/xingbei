"""Small orchestration contracts; no simulated games or GPU work."""
from contextlib import nullcontext
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

import population


class PopulationTests(unittest.TestCase):
    def test_diverse_league_keeps_frozen_anchors_and_v15_scope(self):
        from collections import Counter
        from league import training_configs
        config=dict(index=14976,count=192,completed=14976,revision='test',
                    positions=[],excluded=set(),historical='model:history',
                    league_profile='diverse-v1',anchor='model:anchor417')
        games,_=training_configs(**config)
        self.assertEqual(Counter(g['opponent'] for g in games),dict(self=58,
            **{'model:anchor417':38,'model:history':29,'v1.17.0-preview.5':29,
               'v1.5':19,'legacy-score-partial-v1':19}))
        six={'berserker','windSwordmaster','marksman','sealer','guardianAngel','priest'}
        for g in games:
            self.assertEqual(len(set(g['heroIds'])),6)
            if g['opponent']=='v1.5':
                self.assertEqual(set(g['heroIds']),six)
                self.assertNotIn('replay',g)
        with self.assertRaisesRegex(ValueError,'frozen 417'):
            training_configs(**{**config,'anchor':None})

    def state(self):
        return dict(baseline='base.pt', configuration=dict(style_rounds=2),
                    branches={name: dict(rounds=0, latest=name + '.pt', history=[])
                              for name in (*population.STYLES, *population.ARMS)})

    def test_balanced_schedule_and_frozen_style_routing(self):
        state = self.state()
        order = []
        for _ in range(10):
            name = population.next_branch(state)
            order.append(name)
            state['branches'][name]['rounds'] += 1
        self.assertEqual(order, ['attack', 'cups', 'support'] * 2 + ['control', 'population'] * 2)
        branch = state['branches']['population']
        for step, style in [(0, 'attack'), (2, 'cups'), (4, 'support')]:
            branch['rounds'] = step
            self.assertEqual(population.historical_opponent(state, 'population'),
                             (style + '.pt', 'style:' + style))
        branch['rounds'] = 1
        self.assertEqual(population.historical_opponent(state, 'population'), ('base.pt', 'history'))

    def test_paired_comparison_uses_both_sides_and_checks_seed(self):
        first = dict(results=[dict(seed=1, heroIds=['a'], terminated=True, winner=side)
                              for side in ('red', 'blue')])
        second = dict(results=[dict(seed=1, heroIds=['a'], terminated=True, winner='red') for _ in range(2)])
        comparison = population.paired_difference(first, second)
        self.assertEqual(comparison['win_rate_difference'], .5)
        self.assertEqual(comparison['paired_seed_interval95'], [.5, .5])
        second['results'][1]['seed'] = 2
        with self.assertRaisesRegex(ValueError, 'configurations differ'):
            population.paired_difference(first, second)

    def test_completed_checkpoint_recovers_before_state_commit(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            baseline = directory / 'baseline.pt'
            baseline.write_bytes(b'saved')
            args = SimpleNamespace(directory=directory, checkpoint=baseline, revision='test',
                                   workers=1, batch=2, round_games=4, style_rounds=1, style_weight=.3,
                                   evaluate_every=20, pairs=1, evaluation_seed_base=900000000,
                                   seed=700000000, device='cpu', once=True)
            checkpoint = directory / 'attack' / 'round-000001.pt'
            checkpoint.parent.mkdir()
            checkpoint.write_bytes(b'complete')
            report = dict(completed=4, games=[], rollout={}, update={}, curriculum={'full': 4})
            Path(str(checkpoint) + '.json').write_text(json.dumps(report))
            evaluation = dict(opponents={'rule': dict(games=2, wins=1, win_rate=.5,
                                                       paired_seed_interval95=[0, 1], truncated=0)})
            output = directory / 'evaluations' / 'baseline-000000.json'
            output.parent.mkdir()
            output.write_text(json.dumps(evaluation))
            with patch.object(population, 'Telemetry', return_value=nullcontext()), \
                    patch.object(population, 'catalog', return_value={'ruleTeacher': 'rule'}), \
                    patch.object(population.subprocess, 'run') as process:
                population.run(args)
                process.assert_not_called()
            state = json.loads((directory / 'status.json').read_text())
            self.assertEqual(state['branches']['attack']['completed_games'], 4)
            self.assertEqual(state['branches']['attack']['rounds'], 1)
            self.assertEqual(population.next_branch(state), 'cups')
            state['status'] = 'error'
            population.write_json(directory / 'status.json', state)
            with self.assertRaisesRegex(RuntimeError, 'explicit resolution'):
                population.run(args)


if __name__ == '__main__':
    unittest.main()
