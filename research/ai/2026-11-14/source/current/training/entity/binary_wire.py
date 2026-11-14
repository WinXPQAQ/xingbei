"""Decode numeric transport frames into round-local CPU tensors."""
import sys
import os
import torch
from model import SCHEMA


def decode_tensor(observation, body, vocabulary):
    if sys.byteorder != 'little':
        raise ValueError('Tensor transport requires a little-endian host')
    if (observation.get('wire') != 'tensor-v1' or observation.get('schema') != SCHEMA
            or observation.get('vocabulary') != vocabulary.digest):
        raise ValueError('Tensor wire/checkpoint mismatch')
    names = ('entity_count', 'action_count', 'feature_count', 'reference_count', 'weight_count', 'question')
    counts = [observation.get(name) for name in names]
    if any(type(value) is not int or value < 0 for value in counts):
        raise ValueError('Invalid tensor frame counts')
    entities, actions, features, references, numeric, question = counts
    if not entities or not actions or not features or question >= entities or numeric > features:
        raise ValueError('Invalid tensor frame dimensions')
    index_bytes = observation.get('indexBytes')
    if type(index_bytes) is not int or index_bytes not in (2, 4):
        raise ValueError('Invalid tensor index width')
    lengths = (features, features, references, references, references, numeric)
    weight_offset = (sum(lengths) * index_bytes + 3) // 4 * 4
    if len(body) != weight_offset + numeric * 4:
        raise ValueError('Tensor frame length mismatch')
    # Own writable storage for frombuffer. Each frame is independent.
    storage = bytearray(body)
    dtype = torch.uint16 if index_bytes == 2 else torch.uint32
    if os.environ.get('XINGBEI_DECODE_MODE') == 'packed':
        # One allocation/conversion for all indices; split views retain their
        # owner and the existing bounds/finite checks below stay unchanged.
        parts = torch.frombuffer(storage, dtype=dtype, count=sum(lengths)).long().split(lengths)
    else:
        offset = 0
        parts = []
        for length in lengths:
            parts.append(torch.frombuffer(storage, dtype=dtype, count=length, offset=offset).long()
                         if length else torch.empty(0, dtype=torch.long))
            offset += length * index_bytes
    rows, ids, source, target, roles, weight_indices = parts
    for values, limit in ((rows, entities + actions), (source, entities + actions),
                          (target, entities), (ids, len(vocabulary.symbols)),
                          (roles, len(vocabulary.symbols)), (weight_indices, features)):
        if values.numel() and int(values.max()) >= limit:
            raise ValueError('Tensor frame index out of bounds')
    weights = torch.ones(features, dtype=torch.float32)
    if numeric:
        values = torch.frombuffer(storage, dtype=torch.float32, count=numeric, offset=weight_offset)
        if not torch.isfinite(values).all():
            raise ValueError('Nonfinite tensor feature')
        weights[weight_indices] = values
    tensors = dict(rows=rows, ids=ids, weights=weights, source=source, target=target, roles=roles,
                   question=torch.tensor([question]), entities=entities, actions=actions,
                   mask=torch.zeros((1, entities + actions), dtype=torch.bool))
    return {**observation, 'tensors': tensors}
