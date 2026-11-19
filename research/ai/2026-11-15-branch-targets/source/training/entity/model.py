"""Entity policy prototype. Separate actor/critic; no privileged observations.

Vocabulary is explicit and checkpointed. Unknown features map to UNK, never hash.
An entity is encoded once; candidate pointers reuse contextual entity vectors.
"""
import math
import hashlib
import json
import os
from copy import deepcopy
import torch
from torch import nn

SCHEMA = 'entities-v7'


def features(token):
    yield 'kind=' + token['kind'], 1.0
    for key, value in token['categorical'].items():
        for item in value if isinstance(value, list) else [value]:
            yield f'{key}={item}', 1.0
    for key, value in token['numbers'].items():
        if value is not None:
            yield 'number:' + key, math.copysign(math.log1p(abs(value)), value)


class Vocabulary:
    def __init__(self, symbols=None):
        self.symbols = symbols or ['<pad>', '<unknown>']
        self.ids = {symbol: i for i, symbol in enumerate(self.symbols)}
        self.digest = hashlib.sha256(json.dumps(self.symbols, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()

    @classmethod
    def fit(cls, observations):
        symbols = set()
        for observation in observations:
            for token in observation['entities'] + observation['candidates']:
                symbols.update(key for key, _ in features(token))
                for role, pointers in token['refs'].items():
                    symbols.update('ref:' + role + (f':{i}' if role == 'targets' else '') for i in range(len(pointers)))
        return cls(['<pad>', '<unknown>'] + sorted(symbols))

    def id(self, symbol):
        return self.ids.get(symbol, 1)



def pack_observation(observation, vocabulary):
    """Cache fixed features once per dataset, not on every optimizer step."""
    if observation['schema'] != SCHEMA or observation.get('wire'):
        raise ValueError('Expected raw entity observation')
    def pack(token):
        pairs = [(vocabulary.id(symbol), weight) for symbol, weight in features(token)]
        links = [(vocabulary.id('ref:' + role + (f':{i}' if role == 'targets' else '')), pointer)
                 for role, pointers in token['refs'].items() for i, pointer in enumerate(pointers)]
        return [[p[0] for p in pairs], [p[1] for p in pairs], [p[0] for p in links], [p[1] for p in links]]
    question = observation['entities'][observation['question']]['categorical']
    return dict(schema=SCHEMA, wire='sparse-v1', vocabulary=vocabulary.digest,
                question=observation['question'],
                decision_type=question['type'], decision_stage=question.get('stage', 'complete'),
                decision_skill=question.get('skill'),
                entities=[pack(t) for t in observation['entities']], candidates=[pack(t) for t in observation['candidates']],
                **({'v3': observation['v3']} if 'v3' in observation else {}))


def with_v3_routing(batch, observations, device):
    routes = [observation.get('v3') for observation in observations]
    if all(route is None for route in routes):
        return batch
    ordinary, sage = [], []
    for observation, route in zip(observations, routes):
        actions = (observation['action_count'] if observation.get('wire') == 'tensor-v1'
                   else len(observation['candidates']))
        if (not isinstance(route, dict) or not isinstance(route.get('hero'), str) or not route['hero']
                or not isinstance(route.get('ordinary'), list) or len(route['ordinary']) != actions
                or any(type(flag) is not bool for flag in route['ordinary'])):
            raise ValueError('Invalid V3 decision routing')
        ordinary.append(route['ordinary'] + [False] * (batch['actions'] - actions))
        sage.append(route['hero'] == 'sage')
    return {**batch, 'v3_ordinary': torch.tensor(ordinary, device=device, dtype=torch.bool),
            'v3_sage': torch.tensor(sage, device=device, dtype=torch.bool)}


def prepare_observation(observation, vocabulary):
    if observation.get('wire') == 'tensor-v1':
        if observation['schema'] != SCHEMA or observation['vocabulary'] != vocabulary.digest:
            raise ValueError('Tensor observation/checkpoint mismatch')
        return with_v3_routing(observation['tensors'], [observation], 'cpu')
    return collate([observation], vocabulary)


def collate_prepared(entries, device='cpu'):
    batch = collate_prepared_tokens(entries, device)
    if not any('v3_ordinary' in entry for entry in entries):
        return batch
    if not all('v3_ordinary' in entry and 'v3_sage' in entry for entry in entries):
        raise ValueError('V3 routing missing from part of the policy batch')
    ordinary = nn.utils.rnn.pad_sequence(
        [entry['v3_ordinary'][0] for entry in entries], batch_first=True).to(device)
    return {**batch, 'v3_ordinary': ordinary,
            'v3_sage': torch.cat([entry['v3_sage'] for entry in entries]).to(device)}


def collate_prepared_tokens(entries, device):
    if str(device).startswith('cuda') and os.environ.get('XINGBEI_COLLATE_MODE') == 'gpu':
        from batching import collate_gpu
        return collate_gpu(entries, device)
    if len(entries) == 1:
        return {key: value.to(device, copy=True) if isinstance(value, torch.Tensor) else value
                for key, value in entries[0].items()}
    entities = max(entry['entities'] for entry in entries)
    actions = max(entry['actions'] for entry in entries)
    width = entities + actions
    entity_counts = torch.tensor([entry['entities'] for entry in entries])
    action_counts = torch.tensor([entry['actions'] for entry in entries])
    batch = {key: torch.cat([entry[key] for entry in entries])
             for key in ('rows', 'ids', 'weights', 'source', 'target', 'roles', 'question')}
    # Repeat each observation's boundary, candidate padding and batch offset
    # across its features/references, then adjust all indices in two operations.
    layout = torch.stack((entity_counts, entities - entity_counts,
                          torch.arange(len(entries)) * width), dim=1)
    for key in ('rows', 'source'):
        lengths = torch.tensor([entry[key].numel() for entry in entries])
        positions = torch.repeat_interleave(layout, lengths, dim=0, output_size=batch[key].numel())
        batch[key] += (batch[key] >= positions[:, 0]) * positions[:, 1] + positions[:, 2]
        if key == 'source':
            batch['target'] += positions[:, 2]
    columns = torch.arange(width).unsqueeze(0)
    mask = ((columns >= entity_counts.unsqueeze(1))
            & ((columns < entities) | (columns >= entities + action_counts.unsqueeze(1))))
    return {**{key: value.to(device) for key, value in batch.items()},
            'mask': mask.to(device), 'entities': entities, 'actions': actions}


def collate(observations, vocabulary, device='cpu'):
    if any(o.get('wire') == 'tensor-v1' for o in observations):
        return collate_prepared([prepare_observation(o, vocabulary) for o in observations], device)
    if any(o['schema'] != SCHEMA for o in observations):
        raise ValueError('Incompatible observation schema')
    batch = len(observations)
    entity_count = max(len(o['entities']) for o in observations)
    action_count = max(len(o['candidates']) for o in observations)
    width = entity_count + action_count
    rows, ids, weights, source, target, role_ids = [], [], [], [], [], []
    mask = torch.ones((batch, width), dtype=torch.bool)
    for b, observation in enumerate(observations):
        packed = observation.get('wire') == 'sparse-v1'
        if observation.get('wire') not in (None, 'sparse-v1'):
            raise ValueError('Unknown wire format')
        if packed and observation['vocabulary'] != vocabulary.digest:
            raise ValueError('Wire/checkpoint vocabulary mismatch')
        for group, offset in [('entities', 0), ('candidates', entity_count)]:
            mask[b, offset:offset + len(observation[group])] = False
            for i, token in enumerate(observation[group]):
                row = b * width + offset + i
                if packed:
                    feature_ids, feature_weights, roles, pointers = token
                    if len(feature_ids) != len(feature_weights) or len(roles) != len(pointers):
                        raise ValueError('Malformed sparse token')
                    rows.extend([row] * len(feature_ids))
                    ids.extend(feature_ids)
                    weights.extend(feature_weights)
                    for role_id, pointer in zip(roles, pointers):
                        if not 0 <= pointer < len(observation['entities']):
                            raise ValueError('Invalid entity pointer')
                        source.append(row); target.append(b * width + pointer); role_ids.append(role_id)
                    continue
                entries = ((vocabulary.id(symbol), weight) for symbol, weight in features(token))
                relations = ((vocabulary.id('ref:' + role + (f':{i}' if role == 'targets' else '')), pointer)
                             for role, pointers in token['refs'].items() for i, pointer in enumerate(pointers))
                for feature_id, weight in entries:
                    rows.append(row); ids.append(feature_id); weights.append(weight)
                for role_id, pointer in relations:
                    if not 0 <= pointer < len(observation['entities']):
                        raise ValueError('Invalid entity pointer')
                    source.append(row); target.append(b * width + pointer); role_ids.append(role_id)
    tensor = lambda data, dtype=torch.long: torch.tensor(data, dtype=dtype, device=device)
    batch = dict(rows=tensor(rows), ids=tensor(ids), weights=tensor(weights, torch.float32),
                 source=tensor(source), target=tensor(target), roles=tensor(role_ids),
                 mask=mask.to(device), entities=entity_count, actions=action_count,
                 question=tensor([o['question'] for o in observations]))
    return with_v3_routing(batch, observations, device)


class EntityEncoder(nn.Module):
    def __init__(self, vocabulary_size, width=96, layers=2):
        super().__init__()
        self.width = width
        self.features = nn.Embedding(vocabulary_size, width, padding_idx=0)
        self.roles = nn.Embedding(vocabulary_size, width, padding_idx=0)
        self.norm = nn.LayerNorm(width)
        self.transformer = nn.TransformerEncoder(nn.TransformerEncoderLayer(
            width, 4, width * 3, dropout=0, batch_first=True, norm_first=True),
            layers, enable_nested_tensor=False)

    def tokens(self, batch):
        count = batch['mask'].numel()
        vectors = self.features.weight.new_zeros((count, self.width))
        vectors.index_add_(0, batch['rows'], self.features(batch['ids']) * batch['weights'][:, None])
        return self.norm(vectors)

    def relate(self, vectors, batch, contextual=None):
        values = vectors if contextual is None else contextual
        messages = values[batch['target']] * torch.tanh(self.roles(batch['roles']))
        relations = torch.zeros_like(vectors)
        relations.index_add_(0, batch['source'], messages)
        return self.norm(vectors + relations)

    def forward(self, batch, with_actions=True):
        size, total = batch['mask'].shape
        count = batch['entities']
        raw = self.tokens(batch)
        linked = self.relate(raw, batch).reshape(size, total, self.width)
        contextual = self.transformer(linked[:, :count], src_key_padding_mask=batch['mask'][:, :count])
        question = contextual[torch.arange(size, device=contextual.device), batch['question']]
        if not with_actions:
            return question
        # Candidate contents do not enter the entity Transformer. This avoids
        # quadratic attention across the potentially large candidate set.
        all_context = torch.cat((contextual, linked[:, count:]), dim=1).reshape(-1, self.width)
        actions = self.relate(raw, batch, all_context).reshape(size, total, self.width)[:, count:]
        question = contextual[torch.arange(size, device=contextual.device), batch['question']]
        return question, actions


class EntityPolicy(nn.Module):
    def __init__(self, vocabulary_size, width=96, layers=2, value_scale=1.0):
        super().__init__()
        if width < 4 or width % 4 or layers < 1 or not 1 <= value_scale <= 2:
            raise ValueError('Invalid entity model dimensions or value scale')
        self.config = dict(vocabulary_size=vocabulary_size, width=width, layers=layers)
        self.actor = EntityEncoder(**self.config)
        self.critic = EntityEncoder(**self.config)
        self.value_scale = value_scale
        if value_scale != 1:
            self.config['value_scale'] = value_scale
        self.score = nn.Sequential(nn.Linear(width * 2, width), nn.GELU(), nn.Linear(width, 1))
        self.value = nn.Sequential(nn.Linear(width, width), nn.GELU(), nn.Linear(width, 1), nn.Tanh())
        self.v3_phase = None

    def enable_v3(self):
        """Initialize independent hero scores from the existing V2 actor."""
        if self.v3_phase is not None:
            raise ValueError('V3 policy is already initialized')
        self.v3_reference_score = deepcopy(self.score).requires_grad_(False)
        self.v3_sage_score = deepcopy(self.score)
        self.actor.requires_grad_(False)
        self.set_v3_phase('shared')
        return self

    def set_v3_phase(self, phase):
        if phase not in ('shared', 'sage') or not hasattr(self, 'v3_sage_score'):
            raise ValueError('Expected an initialized V3 policy and a valid phase')
        self.v3_phase = phase
        self.score.requires_grad_(phase == 'shared')
        self.v3_sage_score.requires_grad_(phase == 'sage')

    def v3_logits(self, features, batch, valid):
        if 'v3_ordinary' not in batch or 'v3_sage' not in batch:
            raise ValueError('V3 policy requires explicit decision routing')
        ordinary = batch['v3_ordinary'] & valid
        exclusive = valid & ~ordinary
        shared = self.score(features).squeeze(-1)
        reference = self.v3_reference_score(features).squeeze(-1)
        sage = self.v3_sage_score(features).squeeze(-1)
        # Base updates change rankings among ordinary candidates. Preserve the
        # V2 total ordinary score relative to exclusive options at mixed roots.
        # All-ordinary and all-exclusive rows need no offset.
        mixed_ordinary = ordinary & exclusive.any(dim=1, keepdim=True)
        mixed = mixed_ordinary.any(dim=1, keepdim=True)
        def group_logsumexp(logits):
            masked = logits.masked_fill(~mixed_ordinary, -torch.inf)
            return torch.where(mixed, masked, 0.).logsumexp(dim=1, keepdim=True)
        shared = shared + (group_logsumexp(reference) - group_logsumexp(shared))
        sage_scores = torch.where(ordinary, shared + (sage - reference), sage)
        fallback_scores = torch.where(ordinary, shared, reference)
        return torch.where(batch['v3_sage'].unsqueeze(1), sage_scores, fallback_scores)

    def policy_logits(self, batch):
        question, actions = self.actor(batch)
        query = question[:, None].expand(-1, actions.shape[1], -1)
        features = torch.cat((query, actions), dim=-1)
        valid = ~batch['mask'][:, batch['entities']:]
        logits = (self.score(features).squeeze(-1) if self.v3_phase is None
                  else self.v3_logits(features, batch, valid))
        return logits.masked_fill(~valid, -torch.inf)

    def forward(self, batch):
        logits = self.policy_logits(batch)
        return logits, self.predict_values(batch)

    def value_logits(self, batch):
        critic = self.critic(batch, with_actions=False)
        return self.value[:3](critic).squeeze(-1)

    def predict_values(self, batch):
        return torch.tanh(self.value_logits(batch)) * self.value_scale

    def checkpoint(self, vocabulary):
        data = dict(schema=SCHEMA, architecture='entity', config=self.config,
                    symbols=vocabulary.symbols, state=self.state_dict())
        if self.v3_phase is not None:
            data.update(architecture='entity-v3', v3_phase=self.v3_phase)
        return data

    @classmethod
    def restore(cls, checkpoint):
        architecture = checkpoint.get('architecture', 'entity')
        if checkpoint['schema'] != SCHEMA or architecture not in ('entity', 'entity-v3'):
            raise ValueError('Incompatible checkpoint schema')
        model = cls(**checkpoint['config'])
        if architecture == 'entity-v3':
            model.enable_v3()
            model.set_v3_phase(checkpoint['v3_phase'])
        model.load_state_dict(checkpoint['state'])
        return model, Vocabulary(checkpoint['symbols'])
