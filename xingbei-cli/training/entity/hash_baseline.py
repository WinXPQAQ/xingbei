"""Hash/MLP control adapted to the SAME entity observation as the Transformer.

Not an old policy checkpoint: the old schema omits new hero state. References in
candidate commands are dereferenced so the control also sees the selected card.
"""
import importlib.util
from pathlib import Path
import torch
from torch import nn
from model import SCHEMA

spec = importlib.util.spec_from_file_location('legacy_hash_features', Path(__file__).resolve().parents[1] / 'model.py')
legacy = importlib.util.module_from_spec(spec); spec.loader.exec_module(legacy)
STATE_DIM, ACTION_DIM = 2048, 512


def encode(observation, vocabulary=None):
    if observation['schema'] != SCHEMA or observation.get('wire'):
        raise ValueError('Expected raw entity observation')
    entities = observation['entities']
    # Explicit indices preserve relations and sequence instead of collapsing
    # the entire entity array to the legacy hash visitor's unordered '*' path.
    state = legacy.features({'question': observation['question'], 'entities': {str(i): token for i, token in enumerate(entities)}}, STATE_DIM)
    actions = []
    for candidate in observation['candidates']:
        expanded = {**candidate, 'resolved': {role: {str(i): entities[pointer] for i, pointer in enumerate(pointers)}
                    for role, pointers in candidate['refs'].items()}}
        actions.append(legacy.features(expanded, ACTION_DIM))
    return dict(state=state, actions=torch.stack(actions), decision_type=entities[observation['question']]['categorical']['type'])


def collate(observations, vocabulary=None, device='cpu'):
    width = max(len(o['actions']) for o in observations)
    actions = torch.zeros(len(observations), width, ACTION_DIM)
    mask = torch.ones(len(observations), width, dtype=torch.bool)
    for i, observation in enumerate(observations):
        count = len(observation['actions']); actions[i, :count] = observation['actions']; mask[i, :count] = False
    return dict(state=torch.stack([o['state'] for o in observations]).to(device), actions=actions.to(device), mask=mask.to(device))


class HashPolicy(nn.Module):
    def __init__(self, width=112):
        super().__init__()
        self.config = dict(width=width)
        def encoder(size): return nn.Sequential(nn.Linear(size, width), nn.GELU(), nn.Linear(width, width), nn.GELU())
        self.actor = encoder(STATE_DIM); self.action = encoder(ACTION_DIM); self.critic = encoder(STATE_DIM)
        self.score = nn.Sequential(nn.Linear(width*2, width), nn.GELU(), nn.Linear(width, 1))
        self.value = nn.Sequential(nn.Linear(width, width), nn.GELU(), nn.Linear(width, 1), nn.Tanh())

    def forward(self, batch):
        state = self.actor(batch['state']); actions = self.action(batch['actions'])
        logits = self.score(torch.cat((state[:, None].expand(-1, actions.shape[1], -1), actions), -1)).squeeze(-1)
        return logits.masked_fill(batch['mask'], -torch.inf), self.value(self.critic(batch['state'])).squeeze(-1)

    def checkpoint(self, vocabulary):
        return dict(schema=SCHEMA, architecture='hash', config=self.config, symbols=vocabulary.symbols, state=self.state_dict())

    @classmethod
    def restore(cls, checkpoint):
        from model import Vocabulary
        if checkpoint['schema'] != SCHEMA or checkpoint.get('architecture') != 'hash': raise ValueError('Incompatible hash checkpoint')
        model = cls(**checkpoint['config']); model.load_state_dict(checkpoint['state'])
        return model, Vocabulary(checkpoint['symbols'])
