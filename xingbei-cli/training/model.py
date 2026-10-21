"""Small shared actor/critic with explicit per-seat observation memory.

Features contain semantic labels and relative seats only, never entity IDs.
Hashing is fixed and deterministic; collisions are a prototype limitation.
Memory is a deterministic summary of that seat's earlier observations, so PPO
can replay exactly without stale recurrent-network hidden states.
"""
import math
import zlib
import json
import copy
from functools import lru_cache
from array import array

import torch
from torch import nn

STATE_DIM = 2048
ACTION_DIM = 512
SCHEMA = 2
SEAT_FIELDS = {'current', 'player', 'actor', 'target', 'recipient', 'nextTarget',
               'source', 'owner', 'targets'}


def features(value, dimension, categorical=False, joint_cards=False):
    vector = array('f', [0.0]) * dimension

    def add(key, amount):
        code = zlib.crc32(key.encode('utf-8'))
        vector[code % dimension] += amount if code & 0x80000000 else -amount

    def visit(item, path):
        if isinstance(item, dict):
            if joint_cards and all(key in item for key in ('name', 'elements', 'fates')):
                identity = [item.get('category'), item.get('type'), item['name'],
                            sorted(item['elements']), sorted(item['fates']),
                            sorted(item.get('uniqueSkills', [])), item.get('effect')]
                add(path + '/card=' + json.dumps(identity, separators=(',', ':')), 1)
            for key, child in item.items():
                visit(child, path + '/' + key)
        elif isinstance(item, list):
            add(path + '/length', math.log1p(len(item)) / 4)
            items = item[-32:] if path == '/history' else item
            for index, child in enumerate(items):
                # Player positions and history order matter; hand/set order does not.
                suffix = str(index) if path in ('/players', '/history') else '*'
                visit(child, path + '/' + suffix)
        elif item is None:
            add(path + '=null', 1)
        elif isinstance(item, bool):
            add(path + '=' + str(item), 1)
        elif isinstance(item, (int, float)):
            parts = path.rsplit('/', 2)
            key = parts[-2] if parts[-1] == '*' else parts[-1]
            if categorical and isinstance(item, int) and key in SEAT_FIELDS:
                if not 0 <= item < 6:
                    raise ValueError('Invalid relative seat')
                add(path + '=seat:' + str(item), 1)
            else:
                add(path + '/number', math.copysign(math.log1p(abs(item)) / 4, item))
        else:
            add(path + '=' + str(item), 1)

    visit(value, '')
    return torch.frombuffer(vector, dtype=torch.float32).clone().clamp_(-8, 8)


@lru_cache(maxsize=8192)
def action_features(serialized, categorical, joint_cards=False):
    # Preserve insertion order: floating-point hash accumulation must remain
    # identical to the reference encoder. stack() copies cached tensors.
    return features(json.loads(serialized), ACTION_DIM, categorical, joint_cards)


class SeatMemory:
    def __init__(self, categorical=False, joint_cards=False):
        self.states = [torch.zeros(STATE_DIM) for _ in range(6)]
        self.categorical = categorical
        self.joint_cards = joint_cards

    def encode(self, seat, observation):
        assert observation['schema'] == SCHEMA
        state = features({key: value for key, value in observation.items() if key != 'candidates'}, STATE_DIM, self.categorical, self.joint_cards)
        combined = torch.cat((state, self.states[seat]))
        self.states[seat] = self.states[seat] * 0.8 + state * 0.2
        actions = torch.stack([action_features(json.dumps(action, separators=(',', ':'), ensure_ascii=False), self.categorical, self.joint_cards)
                               for action in observation['candidates']])
        return combined, actions


class Policy(nn.Module):
    def __init__(self, hidden=256, feature_encoding='legacy-v2', separate_critic=False, baseline_version=None, baseline_probability=0.95):
        super().__init__()
        if feature_encoding not in ('legacy-v2', 'categorical-seats-v3', 'contextual-seats-v4', 'contextual-joint-v5', 'decision-context-v6'):
            raise ValueError('Unsupported feature encoding')
        if baseline_version not in (None, "v1.5") or not 0.5 < baseline_probability < 1:
            raise ValueError("Invalid residual baseline")
        self.baseline_version = baseline_version
        self.baseline_probability = baseline_probability
        self.feature_encoding = feature_encoding
        self.separate_critic = separate_critic
        self.hidden = hidden
        self.state = nn.Sequential(nn.Linear(STATE_DIM * 2, hidden), nn.Tanh(), nn.Linear(hidden, hidden), nn.Tanh())
        self.action = nn.Sequential(nn.Linear(ACTION_DIM, 128), nn.Tanh(), nn.Linear(128, hidden), nn.Tanh())
        self.value = nn.Linear(hidden, 1)
        self.bias = nn.Linear(hidden, 1)
        if baseline_version:
            # Zero actor output preserves the exact baseline argmax at initialization.
            nn.init.zeros_(self.action[-2].weight)
            nn.init.zeros_(self.action[-2].bias)
            nn.init.zeros_(self.bias.weight)
            nn.init.zeros_(self.bias.bias)
        if separate_critic:
            self.critic_state = copy.deepcopy(self.state)

    def forward(self, states, actions, mask, baseline=None):
        state = self.state(states)
        action = self.action(actions)
        logits = (state[:, None, :] * action).sum(-1) / math.sqrt(self.hidden) + self.bias(action).squeeze(-1)
        if self.baseline_version:
            if baseline is None or baseline.shape != mask.shape[:1]:
                raise ValueError('Residual policy requires a baseline choice for every row')
            if ((baseline < 0) | (baseline >= mask.shape[1])).any() or not mask.gather(1, baseline[:, None]).all():
                raise ValueError('Baseline choice is not legal')
            # Fixed total exploration mass, independent of candidate count.
            # Greedy starts exactly at v1.5; sampled training intentionally explores.
            count = mask.sum(-1).clamp_min(2).to(logits.dtype)
            margin = torch.log((count - 1) * self.baseline_probability / (1 - self.baseline_probability))
            logits = logits.scatter_add(1, baseline[:, None], margin[:, None])
        elif baseline is not None:
            raise ValueError('Unexpected baseline for independent policy')
        value_state = self.critic_state(states) if self.separate_critic else state
        return logits.masked_fill(~mask, -torch.inf), self.value(value_state).squeeze(-1)


def load_policy_state(model, saved):
    if saved.get('baselineVersion') != model.baseline_version or saved.get('baselineProbability', 0.95) != model.baseline_probability:
        raise ValueError('Checkpoint baseline mismatch')
    if saved['schema'] != SCHEMA or saved.get('featureEncoding', 'legacy-v2') != model.feature_encoding:
        raise ValueError('Checkpoint feature encoding mismatch')
    if model.separate_critic and not saved.get('separateCritic', False):
        missing, unexpected = model.load_state_dict(saved['model'], strict=False)
        expected = {'critic_state.' + key for key in model.critic_state.state_dict()}
        if set(missing) != expected or unexpected:
            raise ValueError('Unexpected architecture conversion')
        model.critic_state.load_state_dict(model.state.state_dict())
    else:
        model.load_state_dict(saved['model'])


def policy_from_checkpoint(saved, device='cpu'):
    model = Policy(feature_encoding=saved.get('featureEncoding', 'legacy-v2'),
                   separate_critic=saved.get('separateCritic', False), baseline_version=saved.get('baselineVersion'),
                   baseline_probability=saved.get('baselineProbability', 0.95)).to(device)
    load_policy_state(model, saved)
    return model


def batch(records, device):
    states = torch.stack([row['state'] for row in records]).to(device)
    maximum = max(len(row['actions']) for row in records)
    actions = torch.zeros(len(records), maximum, ACTION_DIM, device=device)
    mask = torch.zeros(len(records), maximum, dtype=torch.bool, device=device)
    for index, row in enumerate(records):
        count = len(row['actions'])
        actions[index, :count] = row['actions'].to(device)
        mask[index, :count] = True
    if any("baselineChoice" in row for row in records):
        return states, actions, mask, torch.tensor([row["baselineChoice"] for row in records], dtype=torch.long, device=device)
    return states, actions, mask
