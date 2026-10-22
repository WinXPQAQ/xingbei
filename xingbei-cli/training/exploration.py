"""Optional training-only proposal bias; no extra reward or deployment rule."""
import torch


def exploration_bias(observation, strength=0.35):
    candidates = observation['candidates']
    bias = [0.0] * len(candidates)
    own = observation['players'][0]
    for i, candidate in enumerate(candidates):
        if (candidate['type'] == 'refine'
                and sum((candidate.get('stones') or {}).values()) == 2):
            bias[i] += strength
        if own['hero'] != 'berserker' or observation['request']['type'] != 'action':
            continue
        cards = candidate.get('cards', [])
        targets = candidate.get('targets', [])
        if len(cards) != 1 or len(targets) != 1 or cards[0].get('type') != 'attack':
            continue
        card = cards[0]
        if 'bloodyRoar' not in card.get('uniqueSkills', []):
            continue
        if observation['players'][targets[0]]['healing'] == 2:
            continue
        # Only discourage consuming the roar when an ordinary same-element
        # attack against the SAME target is actually a legal candidate.
        alternative = any(other['type'] == candidate['type']
            and other.get('targets') == targets and len(other.get('cards', [])) == 1
            and other['cards'][0].get('type') == 'attack'
            and other['cards'][0].get('elements') == card.get('elements')
            and not set(other['cards'][0].get('uniqueSkills', [])) & {'bloodyRoar', 'bloodBlade'} for other in candidates)
        if alternative:
            bias[i] -= strength
    return bias


def proposal_logits(logits, rows, temperatures):
    result = logits / temperatures[:, None]
    if any('explorationBias' in row for row in rows):
        bias = torch.zeros_like(result)
        for i, row in enumerate(rows):
            values = row.get('explorationBias', [0.0] * len(row['actions']))
            if len(values) != len(row['actions']):
                raise ValueError('Exploration bias must align with legal candidates')
            bias[i, :len(values)] = torch.tensor(values, device=logits.device)
        result = result + bias
    return result
