"""Batch numeric observations without changing their feature or action order."""
import torch


def collate_gpu(entries, device):
    entities = max(entry['entities'] for entry in entries)
    actions = max(entry['actions'] for entry in entries)
    width, count = entities + actions, len(entries)
    sizes = [(entry['entities'], entry['actions'], entry['rows'].numel(), entry['source'].numel())
             for entry in entries]
    features = sum(size[2] for size in sizes)
    references = sum(size[3] for size in sizes)
    keys = ('rows', 'ids', 'source', 'target', 'roles', 'question')
    # Two host-to-device transfers, instead of one for each tensor. Padding and
    # reference offsets are applied to the private device buffer in batch.
    packed = torch.cat([entry[key] for key in keys for entry in entries] +
                       [torch.tensor(sizes, dtype=torch.long).flatten()]).to(device)
    rows, ids, source, target, roles, question, metadata = packed.split(
        [features, features, references, references, references, count, count * 4])
    metadata = metadata.view(count, 4)
    weights = torch.cat([entry['weights'] for entry in entries]).to(device)
    entity_counts, action_counts = metadata[:, 0], metadata[:, 1]
    layout = torch.stack((entity_counts, entities - entity_counts,
                          torch.arange(count, device=device) * width), dim=1)
    for values, lengths, total in ((rows, metadata[:, 2], features),
                                   (source, metadata[:, 3], references)):
        positions = torch.repeat_interleave(layout, lengths, dim=0, output_size=total)
        values.add_((values >= positions[:, 0]) * positions[:, 1] + positions[:, 2])
        if values is source:
            target.add_(positions[:, 2])
    columns = torch.arange(width, device=device).unsqueeze(0)
    mask = ((columns >= entity_counts.unsqueeze(1)) &
            ((columns < entities) | (columns >= entities + action_counts.unsqueeze(1))))
    return dict(rows=rows, ids=ids, weights=weights, source=source, target=target, roles=roles,
                question=question, mask=mask, entities=entities, actions=actions)
