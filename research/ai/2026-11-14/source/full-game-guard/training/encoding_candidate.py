"""Candidate feature experiment: seat identities are categories, not magnitudes.

Uses only the existing detached observation. No strategic score or reward added.
"""
from model import SeatMemory, SEAT_FIELDS


def categorical_seats(value, key=None):
    if isinstance(value, dict):
        return {name: categorical_seats(child, name) for name, child in value.items()}
    if isinstance(value, list):
        return [categorical_seats(child, key) for child in value]
    if key in SEAT_FIELDS and isinstance(value, int) and not isinstance(value, bool):
        if not 0 <= value < 6:
            raise ValueError('Invalid relative seat')
        return f'seat:{value}'
    return value


class CategoricalSeatMemory(SeatMemory):
    def __init__(self, joint_cards=False):
        super().__init__(categorical=True, joint_cards=joint_cards)


class ContextualSeatMemory(CategoricalSeatMemory):
    def encode(self, seat, observation):
        players = observation['players']
        public = lambda index: {key: value for key, value in players[index].items() if key != 'hand'}
        candidates = []
        for candidate in observation['candidates']:
            targets = candidate.get('targets', [])
            if candidate.get('target') is not None:
                targets = [candidate['target']]
            candidates.append({**candidate, 'actingHero': players[0]['hero'],
                               'targetPlayers': [public(index) for index in targets]})
        # Explicitly pair candidate cards with their public targets. The model
        # still learns the value: no hit estimates, scores or policy advice.
        return super().encode(seat, {**observation, 'candidates': candidates})


class DecisionSeatMemory(ContextualSeatMemory):
    def encode(self, seat, observation):
        own = observation['players'][0]
        candidates = []
        for candidate in observation['candidates']:
            selected = candidate.get('cards', [])
            if candidate.get('card') is not None:
                selected = [candidate['card']]
            unselected = list(own['hand'] or [])
            for card in selected:
                if card in unselected:
                    unselected.remove(card)
            candidates.append({**candidate, 'unselectedHand': unselected,
                               'selfPublic': {key: value for key, value in own.items() if key != 'hand'},
                               'decisionContext': observation.get('request', {})})
        # This is a partition of the observed hand, NOT a prediction that the
        # selected cards leave it. Reveal/give/discard semantics stay in rules.
        return super().encode(seat, {**observation, 'candidates': candidates})


def seat_memory(encoding):
    if encoding == 'legacy-v2':
        return SeatMemory()
    if encoding == 'categorical-seats-v3':
        return CategoricalSeatMemory()
    if encoding == 'contextual-seats-v4':
        return ContextualSeatMemory()
    if encoding == 'contextual-joint-v5':
        return ContextualSeatMemory(joint_cards=True)
    if encoding == 'decision-context-v6':
        return DecisionSeatMemory(joint_cards=True)
    raise ValueError('Unsupported feature encoding')
