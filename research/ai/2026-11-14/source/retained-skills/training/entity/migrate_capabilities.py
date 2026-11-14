"""Extend an entity-v6 checkpoint with zero-initialized capability features."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import subprocess

import torch

from checkpoint_io import save_checkpoint
from learning import parameter_groups
from model import EntityPolicy, SCHEMA

ROOT = Path(__file__).resolve().parents[2]
EMBEDDINGS = ('actor.features.weight', 'actor.roles.weight',
              'critic.features.weight', 'critic.roles.weight')


def migrate(checkpoint, symbols, revision):
    if checkpoint.get('schema') != 'entities-v6' or SCHEMA != 'entities-v7':
        raise ValueError('Expected an entity-v6 checkpoint and entity-v7 target')
    if checkpoint.get('architecture', 'entity') != 'entity':
        raise ValueError('Expected an entity policy checkpoint')
    previous_symbols = checkpoint['symbols']
    added = sorted(set(symbols) - set(previous_symbols))
    if not added:
        raise ValueError('No new capability features to migrate')
    result = copy.deepcopy(checkpoint)
    result['schema'] = SCHEMA
    result['symbols'] = previous_symbols + added
    result['config']['vocabulary_size'] = len(result['symbols'])
    for name in EMBEDDINGS:
        original = checkpoint['state'][name]
        if original.shape[0] != len(previous_symbols):
            raise ValueError(f'Embedding/vocabulary mismatch for {name}')
        expanded = original.new_zeros((len(result['symbols']), original.shape[1]))
        expanded[:len(previous_symbols)] = original
        result['state'][name] = expanded

    # Restore old optimizer moments by parameter identity, then extend only
    # vocabulary-shaped moment tensors. All other state remains intact.
    if checkpoint.get('optimizer'):
        compatible = {**checkpoint, 'schema': SCHEMA}
        old_model, _ = EntityPolicy.restore(compatible)
        names = {id(parameter): name for name, parameter in old_model.named_parameters()}
        split = 'actor' in result['optimizer']
        optimizers = result['optimizer'] if split else {'joint': result['optimizer']}
        groups = parameter_groups(old_model) if split else {'joint': list(old_model.parameters())}
        for group, optimizer in optimizers.items():
            ids = [index for entry in optimizer['param_groups'] for index in entry['params']]
            if len(ids) != len(groups[group]):
                raise ValueError('Optimizer parameter count differs from model')
            for index, parameter in zip(ids, groups[group]):
                name = names[id(parameter)]
                if name not in EMBEDDINGS:
                    continue
                for key, value in optimizer['state'].get(index, {}).items():
                    if isinstance(value, torch.Tensor) and value.shape == parameter.shape:
                        expanded = value.new_zeros(result['state'][name].shape)
                        expanded[:len(previous_symbols)] = value
                        optimizer['state'][index][key] = expanded
    result['revision'] = revision
    result['migration'] = dict(source_schema=checkpoint['schema'], target_schema=SCHEMA,
        source_revision=checkpoint.get('revision'), target_revision=revision,
        added_symbols=added, feature_initialization='zero', positions_reused=False)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('checkpoint', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--revision', required=True)
    args = parser.parse_args()
    script = "import { ACTION_CAPABILITY_SYMBOLS } from './src/ai/action-capability.js'; console.log(JSON.stringify(ACTION_CAPABILITY_SYMBOLS));"
    symbols = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', script], cwd=ROOT, text=True))
    checkpoint = torch.load(args.checkpoint, map_location='cpu', weights_only=False)
    result = migrate(checkpoint, symbols, args.revision)
    result['parent_checkpoint'] = str(args.checkpoint.resolve())
    result['migration']['source_sha256'] = hashlib.sha256(args.checkpoint.read_bytes()).hexdigest()
    save_checkpoint(args.output, result, result['migration'])
    print(json.dumps(result['migration']))


if __name__ == '__main__':
    main()
