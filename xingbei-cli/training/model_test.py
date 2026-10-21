import argparse
import pathlib
import tempfile
import unittest

import torch
from model import Policy, SeatMemory, SCHEMA, batch, features, STATE_DIM, ACTION_DIM
from train import checkpoint, update, initialize_weights
from encoding_candidate import categorical_seats, seat_memory


def observation():
    return {'schema': SCHEMA, 'players': [{'hero': 'sealer', 'hand': [{'elements': ['water'], 'uniqueSkills': ['waterSeal']}]}],
            'candidates': [{'type': 'decline'}, {'type': 'response', 'card': {'elements': ['water']}}]}


class ModelTests(unittest.TestCase):
    def test_joint_cards_distinguish_actual_deck_attribute_skill_pairings(self):
        def card(element, fate, skills):
            return {'name': element + 'Strike', 'type': 'attack', 'category': 'basic',
                    'elements': [element], 'fates': [fate], 'uniqueSkills': skills}
        blood = ['bloodyRoar', 'bloodLament']
        storm = ['stormArt', 'precisionShot']
        first = {'hand': [card('wind', 'X', blood), card('earth', 'J', storm)]}
        second = {'hand': [card('wind', 'J', storm), card('earth', 'X', blood)]}
        self.assertTrue(torch.equal(features(first, STATE_DIM), features(second, STATE_DIM)))
        self.assertFalse(torch.equal(features(first, STATE_DIM, joint_cards=True), features(second, STATE_DIM, joint_cards=True)))

    def test_fast_encoding_exactly_matches_reference(self):
        import json
        from model import action_features
        source = {'schema': SCHEMA, 'current': 0, 'players': [{'hero': 'priest', 'handCount': 6}],
                  'history': [{'actor': i % 6, 'target': (i + 1) % 6, 'amount': i % 3} for i in range(100)],
                  'candidates': [{'targets': [0, 5], 'count': 2, 'card': {'owner': 0, 'elements': ['water']}}]}
        state = {key: value for key, value in source.items() if key != 'candidates'}
        self.assertTrue(torch.equal(features(categorical_seats(state), STATE_DIM), features(state, STATE_DIM, True)))
        action = source['candidates'][0]
        expected = features(categorical_seats(action), ACTION_DIM)
        actual = action_features(json.dumps(action, separators=(',', ':')), True)
        self.assertTrue(torch.equal(expected, actual))
        _, actions = seat_memory('categorical-seats-v3').encode(0, source)
        actions.zero_()
        self.assertTrue(torch.equal(actual, expected))

    def test_categorical_seats_preserve_counts_and_memory_isolation(self):
        source = {'current': 0, 'candidates': [{'targets': [0, 5], 'count': 2}]}
        converted = categorical_seats(source)
        self.assertEqual(converted, {'current': 'seat:0', 'candidates': [{'targets': ['seat:0', 'seat:5'], 'count': 2}]})
        self.assertEqual(source['current'], 0)
        memory = seat_memory('categorical-seats-v3')
        before, _ = memory.encode(0, observation())
        other, _ = memory.encode(1, observation())
        self.assertTrue(torch.equal(before, other))
        with self.assertRaises(ValueError):
            seat_memory('unknown')

    def test_target_context_uses_public_counts_and_does_not_mutate_observation(self):
        source = {'schema': SCHEMA, 'players': [
            {'hero': 'sealer', 'handCount': 4, 'hand': []},
            {'hero': 'berserker', 'handCount': 3, 'hand': None}],
            'candidates': [{'type': 'target', 'target': 1}]}
        _, before = seat_memory('contextual-seats-v4').encode(0, source)
        self.assertNotIn('targetPlayers', source['candidates'][0])
        source['players'][1]['handCount'] = 5
        _, after = seat_memory('contextual-seats-v4').encode(0, source)
        self.assertFalse(torch.equal(before, after))

    def test_seat_memory_isolated(self):
        memory = SeatMemory()
        before, _ = memory.encode(0, observation())
        other, _ = memory.encode(1, observation())
        self.assertTrue(torch.equal(before, other))
        again, _ = memory.encode(0, observation())
        self.assertFalse(torch.equal(before, again))
        reset, _ = SeatMemory().encode(0, observation())
        self.assertTrue(torch.equal(before, reset))

    def test_masks_updates_and_checkpoint_roundtrip(self):
        torch.set_num_threads(1)
        torch.manual_seed(7)
        memory = SeatMemory()
        state, actions = memory.encode(0, observation())
        rows = [{'state': state, 'actions': actions, 'choice': 1, 'return': 1.0},
                {'state': state, 'actions': actions[:1], 'choice': 0, 'return': -1.0}]
        model = Policy()
        optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
        inputs = batch(rows, 'cpu')
        logits, values = model(*inputs)
        self.assertTrue(torch.isneginf(logits[1, 1]))
        self.assertEqual(torch.softmax(logits, -1)[1, 1].item(), 0)
        distribution = torch.distributions.Categorical(logits=logits)
        for index, row in enumerate(rows):
            row['logp'] = distribution.log_prob(torch.tensor([1, 0]))[index].item()
            row['value'] = values[index].item()
        original = [value.detach().clone() for value in model.parameters()]
        diagnostics = {}
        loss = update(model, optimizer, rows, 'cpu', imitation=False, epochs=1, diagnostics=diagnostics)
        self.assertTrue(torch.isfinite(torch.tensor(loss)))
        self.assertGreaterEqual(diagnostics['approximateKL'], -1e-6)
        self.assertTrue(0 <= diagnostics['clipFraction'] <= 1)
        self.assertEqual(diagnostics['terminalReturnMean'], 0)
        self.assertTrue(any(not torch.equal(a, b) for a, b in zip(original, model.parameters())))
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'model.pt'
            checkpoint(path, model, optimizer, 3, argparse.Namespace(seed=7))
            expected_random = torch.rand(8)
            saved = torch.load(path, weights_only=False)
            restored = Policy()
            restored.load_state_dict(saved['model'])
            restored_optimizer = torch.optim.Adam(restored.parameters())
            restored_optimizer.load_state_dict(saved['optimizer'])
            torch.set_rng_state(saved['torch_rng'])
            self.assertTrue(torch.equal(torch.rand(8), expected_random))
            self.assertTrue(torch.equal(model(*inputs)[0], restored(*inputs)[0]))
            self.assertEqual(saved['completed'], 3)
            self.assertEqual(len(optimizer.state), len(restored_optimizer.state))
            initialized = Policy()
            metadata = initialize_weights(path, initialized, 'cpu')
            self.assertTrue(torch.equal(model(*inputs)[0], initialized(*inputs)[0]))
            self.assertEqual(metadata['parentCompleted'], 3)
            with self.assertRaises(ValueError):
                initialize_weights(path, Policy(feature_encoding='contextual-joint-v5'), 'cpu')


if __name__ == '__main__':
    unittest.main()
