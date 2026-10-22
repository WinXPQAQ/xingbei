import unittest
import json
import subprocess
from pathlib import Path
import torch
from exploration import exploration_bias, proposal_logits


class ExplorationTest(unittest.TestCase):
    def fixture(self, healing):
        attack = {'type': 'attack', 'elements': ['fire'], 'uniqueSkills': ['fireSeal']}
        roar = {**attack, 'uniqueSkills': ['bloodyRoar']}
        return {'players': [{'hero': 'berserker'}, {'healing': healing}],
                'request': {'type': 'action'}, 'candidates': [
                    {'type': 'attack', 'cards': [roar], 'targets': [1]},
                    {'type': 'attack', 'cards': [attack], 'targets': [1]},
                    {'type': 'refine', 'stones': {'gem': 1, 'crystal': 1}},
                    {'type': 'refine', 'stones': {'gem': 1, 'crystal': 0}}]}

    def test_conditional_preservation_and_two_stone_exploration(self):
        self.assertEqual(exploration_bias(self.fixture(1)), [-.35, 0, .35, 0])
        self.assertEqual(exploration_bias(self.fixture(2)), [0, 0, .35, 0])
        data = self.fixture(1)
        data['candidates'].pop(1)
        self.assertEqual(exploration_bias(data), [0, .35, 0])

    def test_real_engine_roar_fixtures_have_matched_elements(self):
        fixtures = json.loads(subprocess.check_output(['node', str(Path(__file__).with_name('diagnostics.mjs')), '--baseline']))
        for fixture in fixtures:
            if 'roar' not in fixture['name']:
                continue
            bias = exploration_bias(fixture['observation'])
            if fixture['name'] == 'preserve-inactive-roar':
                self.assertEqual(sum(x < 0 for x in bias), 3)
                self.assertTrue(all(bias[i] == 0 for i in fixture['preferred']))
            else:
                self.assertTrue(all(x == 0 for x in bias))

    def test_sampling_and_ppo_replay_use_same_distribution(self):
        logits = torch.tensor([[1., 2., 3., float('-inf')]], requires_grad=True)
        rows = [{'actions': [1, 2, 3], 'explorationBias': [-.35, 0, .35]}]
        temperature = torch.tensor([1.3])
        sample = torch.distributions.Categorical(logits=proposal_logits(logits.detach(), rows, temperature))
        replay = torch.distributions.Categorical(logits=proposal_logits(logits, rows, temperature))
        torch.testing.assert_close(sample.log_prob(torch.tensor([2])), replay.log_prob(torch.tensor([2])))
        self.assertEqual(float(replay.probs[0, 3].detach()), 0)
        (-replay.log_prob(torch.tensor([2]))).backward()
        self.assertTrue(torch.isfinite(logits.grad).all())
        torch.testing.assert_close(proposal_logits(logits, [{'actions': [1, 2, 3]}], temperature), logits / 1.3)


if __name__ == '__main__':
    unittest.main()
