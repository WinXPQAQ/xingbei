"""Seat/lineup schedules shared by training and paired evaluation."""
TEAMS = ['red', 'blue', 'blue', 'red', 'red', 'blue']
DEFAULT = ['berserker', 'windSwordmaster', 'marksman', 'sealer', 'guardianAngel', 'priest']
LINEUPS = {
    'default': None,
    'assault': ['berserker', 'windSwordmaster', 'marksman'],
    'spell': ['marksman', 'sealer', 'priest'],
    'support': ['sealer', 'guardianAngel', 'priest'],
    'mixed': ['berserker', 'guardianAngel', 'priest'],
    'tempo': ['windSwordmaster', 'sealer', 'guardianAngel'],
    'pressure': ['windSwordmaster', 'marksman', 'priest'],
}


def roster(name, rotation):
    triple = LINEUPS[name]
    if triple is None:
        # Rotate the six hero identities without changing the mandated seat teams.
        return DEFAULT[rotation % 6:] + DEFAULT[:rotation % 6]
    a, b, c = [triple[(index + rotation) % 3] for index in range(3)]
    return [a, a, b, b, c, c]


def training_configs(first_seed, iteration, games, sampling_seed, imitation):
    configs = []
    for index in range(games):
        seed = first_seed + iteration * games + index
        opponent = ['v1.5', 'v1.4'][index % 2]
        own = ['red', 'blue'][(index // 2) % 2]
        if imitation or index % 3 == 0:
            policies = ['model'] * 6
        elif index % 3 == 1:
            policies = ['model' if team == own else opponent for team in TEAMS]
        else:
            # Learn cooperation with historical teammates, not only self copies.
            policies = [opponent if team == own else 'v1.5' for team in TEAMS]
            seats = [seat for seat, team in enumerate(TEAMS) if team == own]
            policies[seats[(index // 3) % 3]] = 'model'
        name = list(LINEUPS)[(index + iteration) % len(LINEUPS)]
        configs.append({'seed': seed, 'start': index % 6, 'seatPolicies': policies,
                        'samplingSeed': sampling_seed, 'heroIds': roster(name, seed), 'lineup': name})
    return configs


def evaluation_configs(first_seed, seeds, sampling_seed):
    configs = []
    for seed in range(first_seed, first_seed + seeds):
        for name in LINEUPS:
            for own in ('red', 'blue'):
                for start in (0, 1):
                    for mode in ('team', 'mixed'):
                        seats = [seat for seat, team in enumerate(TEAMS) if team == own]
                        controlled = seats if mode == 'team' else [seats[seed % 3]]
                        base = {'seed': seed, 'start': start, 'heroIds': roster(name, seed),
                                'samplingSeed': sampling_seed, 'lineup': name, 'team': own, 'mode': mode}
                        configs.append({**base, 'arm': 'model',
                                        'seatPolicies': ['model' if seat in controlled else 'v1.5' for seat in range(6)]})
                        if mode == 'mixed':
                            configs.append({**base, 'arm': 'control', 'seatPolicies': ['v1.5'] * 6})
    return configs
