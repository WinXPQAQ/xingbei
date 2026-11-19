"""Deterministic final-card selection, after deciding to counter in an element."""
POLICY = 'ordinary-first-v1'


def prefer_ordinary_response(observation, choice):
    if observation['request']['type'] != 'response':
        return choice
    candidates = observation['candidates']
    selected = candidates[choice]
    card = selected.get('card')
    if selected['type'] != 'response' or not card or card['type'] != 'attack':
        return choice
    elements = set(card['elements'])
    # No reinterpretation of holy light/dark or multi-element special cards.
    if card['name'] == 'darkStrike' or len(elements) != 1 or elements & {'dark', 'light'}:
        return choice
    skills = set(observation['players'][0]['skills'])
    if not skills.intersection(card['uniqueSkills']):
        return choice
    for index, candidate in enumerate(candidates):
        alternative = candidate.get('card')
        if (candidate['type'] == 'response' and candidate.get('target') == selected.get('target')
                and alternative and alternative['type'] == 'attack'
                and alternative['name'] != 'darkStrike'
                and set(alternative['elements']) == elements
                and not skills.intersection(alternative['uniqueSkills'])):
            return index
    return choice
