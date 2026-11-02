"""Entity policy prototype. Separate actor/critic; no privileged observations.

Vocabulary is explicit and checkpointed. Unknown features map to UNK, never hash.
An entity is encoded once; candidate pointers reuse contextual entity vectors.
"""
import math
import torch
from torch import nn

SCHEMA = 'entities-v1'


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

    @classmethod
    def fit(cls, observations):
        symbols = set()
        for observation in observations:
            for token in observation['entities'] + observation['candidates']:
                symbols.update(key for key, _ in features(token))
                for role in token['refs']:
                    symbols.add('ref:' + role)
        return cls(['<pad>', '<unknown>'] + sorted(symbols))

    def id(self, symbol):
        return self.ids.get(symbol, 1)


def collate(observations, vocabulary, device='cpu'):
    if any(o['schema'] != SCHEMA for o in observations):
        raise ValueError('Incompatible observation schema')
    batch = len(observations)
    entity_count = max(len(o['entities']) for o in observations)
    action_count = max(len(o['candidates']) for o in observations)
    width = entity_count + action_count
    rows, ids, weights, source, target, role_ids = [], [], [], [], [], []
    mask = torch.ones((batch, width), dtype=torch.bool)
    for b, observation in enumerate(observations):
        for group, offset in [('entities', 0), ('candidates', entity_count)]:
            for i, token in enumerate(observation[group]):
                row = b * width + offset + i
                mask[b, offset + i] = False
                for symbol, weight in features(token):
                    rows.append(row); ids.append(vocabulary.id(symbol)); weights.append(weight)
                for role, pointers in token['refs'].items():
                    for pointer in pointers:
                        if not 0 <= pointer < len(observation['entities']):
                            raise ValueError('Invalid entity pointer')
                        source.append(row); target.append(b * width + pointer)
                        role_ids.append(vocabulary.id('ref:' + role))
    tensor = lambda data, dtype=torch.long: torch.tensor(data, dtype=dtype, device=device)
    return dict(rows=tensor(rows), ids=tensor(ids), weights=tensor(weights, torch.float32),
                source=tensor(source), target=tensor(target), roles=tensor(role_ids),
                mask=mask.to(device), entities=entity_count, actions=action_count,
                question=tensor([o['question'] for o in observations]))


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

    def forward(self, batch):
        size, total = batch['mask'].shape
        count = batch['entities']
        raw = self.tokens(batch)
        linked = self.relate(raw, batch).reshape(size, total, self.width)
        contextual = self.transformer(linked[:, :count], src_key_padding_mask=batch['mask'][:, :count])
        # Candidate contents do not enter the entity Transformer. This avoids
        # quadratic attention across the potentially large candidate set.
        all_context = torch.cat((contextual, linked[:, count:]), dim=1).reshape(-1, self.width)
        actions = self.relate(raw, batch, all_context).reshape(size, total, self.width)[:, count:]
        question = contextual[torch.arange(size, device=contextual.device), batch['question']]
        return question, actions


class EntityPolicy(nn.Module):
    def __init__(self, vocabulary_size, width=96, layers=2):
        super().__init__()
        self.config = dict(vocabulary_size=vocabulary_size, width=width, layers=layers)
        self.actor = EntityEncoder(**self.config)
        self.critic = EntityEncoder(**self.config)
        self.score = nn.Sequential(nn.Linear(width * 2, width), nn.GELU(), nn.Linear(width, 1))
        self.value = nn.Sequential(nn.Linear(width, width), nn.GELU(), nn.Linear(width, 1), nn.Tanh())

    def forward(self, batch):
        question, actions = self.actor(batch)
        query = question[:, None].expand(-1, actions.shape[1], -1)
        logits = self.score(torch.cat((query, actions), dim=-1)).squeeze(-1)
        logits = logits.masked_fill(batch['mask'][:, batch['entities']:], -torch.inf)
        critic, _ = self.critic(batch)
        return logits, self.value(critic).squeeze(-1)

    def checkpoint(self, vocabulary):
        return dict(schema=SCHEMA, config=self.config, symbols=vocabulary.symbols, state=self.state_dict())

    @classmethod
    def restore(cls, checkpoint):
        if checkpoint['schema'] != SCHEMA:
            raise ValueError('Incompatible checkpoint schema')
        model = cls(**checkpoint['config'])
        model.load_state_dict(checkpoint['state'])
        return model, Vocabulary(checkpoint['symbols'])
