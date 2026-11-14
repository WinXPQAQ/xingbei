"""Expand request-scoped entity prefixes before observations enter the model."""
from model import SCHEMA


class WireDecoder:
    def __init__(self):
        self.prefixes = {}

    def decode(self, observation, route):
        if observation.get('wire') != 'sparse-delta-v1':
            return observation
        if observation.get('schema') != SCHEMA:
            raise ValueError('Incompatible delta observation schema')
        prefix_id = observation.get('prefixId')
        if type(prefix_id) is not int or prefix_id < 1:
            raise ValueError('Invalid entity prefix ID')
        vocabulary = observation['vocabulary']
        if 'prefix' in observation:
            # Immutable shared tokens keep retained trajectories independent of
            # later requests. Their outer entity containers remain per sample.
            prefix = tuple(tuple(map(tuple, token)) for token in observation['prefix'])
            self.prefixes[route] = (prefix_id, vocabulary, prefix)
        cached = self.prefixes.get(route)
        if not cached or cached[:2] != (prefix_id, vocabulary):
            raise ValueError('Missing or stale entity prefix')
        prefix = cached[2]
        if type(observation.get('question')) is not int or observation['question'] != len(prefix):
            raise ValueError('Entity prefix does not match question offset')
        expanded = {key: value for key, value in observation.items() if key not in ('prefix', 'prefixId')}
        expanded['wire'] = 'sparse-v1'
        expanded['entities'] = [*prefix, *observation['entities']]
        return expanded
