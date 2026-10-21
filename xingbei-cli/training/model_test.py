import argparse
import pathlib
import tempfile
import unittest

import torch
from model import Policy, SeatMemory, SCHEMA, batch
from train import checkpoint, update


def observation():
    return {'schema': SCHEMA, 'players': [{'hero': 'sealer', 'hand': [{'elements': ['water'], 'uniqueSkills': ['waterSeal']}]}],
            'candidates': [{'type': 'decline'}, {'type': 'response', 'card': {'elements': ['water']}}]}


class ModelTests(unittest.TestCase):
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
        loss = update(model, optimizer, rows, 'cpu', imitation=False, epochs=1)
        self.assertTrue(torch.isfinite(torch.tensor(loss)))
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


if __name__ == '__main__':
    unittest.main()
