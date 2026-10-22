"""Training-only preference for a cheaper equivalent attack from public inputs.

Never treats unknown opponent responses to different elements as equivalent.
These are conservative local equivalences, not a theorem about long-term value.
"""
HERO_SKILLS = {
    'berserker': {'bloodBlade', 'bloodyRoar'},
    'windSwordmaster': {'galeArt', 'stormArt'},
    'marksman': {'flashTrap', 'precisionShot'},
    'sealer': {f'{element}Seal' for element in ('fire','water','wind','earth','thunder')},
    'guardianAngel': {'angelWall'},
    'priest': set(),
}


def resources(card, own):
    relevant = set(card.get('uniqueSkills', [])) & HERO_SKILLS.get(own['hero'], set())
    if 'skills' in own:
        relevant &= set(own['skills'])
    elements = set(card.get('elements', []))
    if own['hero'] == 'guardianAngel':
        for element, skill in [('wind', 'windCleansing'), ('water', 'angelBlessing')]:
            if element in elements and skill in own.get('skills', []): relevant.add(skill)
    if own['hero'] == 'priest' and 'water' in elements and 'waterPower' in own.get('skills', []):
        relevant.add('waterPower')
    if card.get('name') == 'darkStrike': relevant.add('darkStrike')
    return relevant


def attack_info(observation, candidate):
    kind = observation['request']['type']
    if kind == 'action' and candidate['type'] == 'play':
        cards, targets = candidate.get('cards', []), candidate.get('targets', [])
        active = True
    elif kind == 'response' and candidate['type'] == 'response':
        cards, targets = [candidate.get('card')], [candidate.get('target')]
        active = False
    else: return None
    if len(cards) != 1 or len(targets) != 1 or targets[0] is None or not cards[0] or cards[0].get('type') != 'attack':
        return None
    own, target = observation['players'][0], observation['players'][targets[0]]
    card = cards[0]; skills = resources(card, own)
    effects = set()
    if active and 'bloodyRoar' in skills and target['healing'] == 2: effects.add('bloodyRoar')
    if active and 'bloodBlade' in skills and target['handCount'] in (2,3): effects.add('bloodBlade')
    if active and 'galeArt' in skills: effects.add('galeArt')
    if 'stormArt' in skills and any(s.get('effect') == 'holyShield' for s in target.get('statuses', [])): effects.add('stormArt')
    if 'precisionShot' in skills: effects.add('precisionShot')
    if own['hero']=='marksman' and 'thunder' in card['elements']: effects.add('lightningArrow')
    # Preserve wind sequencing: do not label a wind swordmaster attack as an
    # ordinary interchangeable element even when the opponent has no cards.
    if own['hero']=='windSwordmaster' and 'wind' in card['elements']: effects.add('windSequence')
    return card, targets[0], skills, effects


def preservation_bias(observation, strength=0.35):
    own = observation['players'][0]
    bias = [0.0] * len(observation['candidates'])
    if own['hero'] not in HERO_SKILLS: return bias
    infos = [attack_info(observation, candidate) for candidate in observation['candidates']]
    for index, info in enumerate(infos):
        if info is None: continue
        card, target_id, skills, effects = info
        # Skills actually useful on THIS attack are not unused future resources.
        if not skills or effects: continue
        for alternative in infos:
            if alternative is None: continue
            other, other_target, other_skills, other_effects = alternative
            if other_target != target_id or other_skills or other_effects: continue
            same_elements = set(card['elements']) == set(other['elements'])
            if not same_elements:
                # Different elements are only demonstrably equivalent here when
                # the recipient has no response cards and exposure cannot trigger
                # an elemental seal on the attacking player.
                if observation['players'][target_id]['handCount'] != 0: continue
                if any((s.get('effect') or '').endswith('Seal') for s in own.get('statuses', [])): continue
            bias[index] = -strength
            break
    return bias
