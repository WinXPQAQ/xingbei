"""Team credit assignment and independently optimized actor/critic parameters."""
import math
import torch

STYLES = ('win', 'attack', 'cups', 'support')


def style_score(result, seat, style):
    """Bounded public behavior preference over the newly played continuation."""
    if style == 'win':
        return 0.
    if style not in STYLES:
        raise ValueError('Unknown behavior style')
    behavior = result.get('publicBehavior', {})
    if behavior.get('schema') != 'team-behavior-v1':
        raise ValueError('Style training requires public continuation statistics')
    team = behavior['seats'][str(seat)]
    other = 'blue' if team == 'red' else 'red'
    own, enemy = behavior['teams'][team], behavior['teams'][other]
    turns = max(1, own['turns'])
    own_morale = own['end']['morale'] - own['start']['morale']
    enemy_morale = enemy['start']['morale'] - enemy['end']['morale']
    if style == 'attack':
        score = .65 * math.tanh(enemy_morale / 6) + .35 * math.tanh(own['attackDamage'] / turns / 3)
    elif style == 'cups':
        own_cups = own['end']['cups'] - own['start']['cups']
        enemy_cups = enemy['end']['cups'] - enemy['start']['cups']
        score = math.tanh((own_cups - .25 * enemy_cups) / 2)
    else:
        healing_flow = own['end']['healing'] - own['start']['healing'] + own['healingSpent']
        support_flow = (healing_flow + own['holyLightBlocks']) / turns
        score = .7 * math.tanh(own_morale / 6) + .3 * math.tanh(support_flow / 2)
    if not math.isfinite(score):
        raise ValueError('Nonfinite public behavior score')
    return min(1., max(-1., score))


def morale_potential(learning):
    """Bounded public team advantage, with greater slope at low morale."""
    if not learning:
        raise ValueError('Morale shaping requires public rollout metadata')
    own, enemy = learning['ownMorale'], learning['enemyMorale']
    if not 0 <= own <= 15 or not 0 <= enemy <= 15:
        raise ValueError('Invalid public morale')
    return (math.log1p(own) - math.log1p(enemy)) / math.log(16)


def training_samples(results, *, method='mc', trace_lambda=0.95, morale_weight=0.0,
                     style='win', style_weight=0.0):
    if method not in ('mc', 'gae') or not 0 <= trace_lambda <= 1 or not 0 <= morale_weight <= 1:
        raise ValueError('Invalid learning signal configuration')
    if style not in STYLES or not 0 <= style_weight <= 1 or (style == 'win' and style_weight):
        raise ValueError('Invalid behavior style configuration')
    rows = []
    for game_id, result in enumerate(results):
        if not result['terminated'] or result['truncated']:
            continue
        rewards = result['rewards']
        if not rewards or any(value not in (-1, 1) for value in rewards.values()):
            raise ValueError('Invalid terminal team rewards')
        seats = {}
        trajectory = result.get('trajectory', [])
        game_rows = [None]*len(trajectory)
        for position, decision in enumerate(trajectory):
            seat = decision['seat']
            if seat not in result.get('learnerSeats', range(6)):
                raise ValueError('Opponent trajectory leaked into learner')
            seats.setdefault(seat, []).append((position, decision))
        for seat, entries in seats.items():
            positions, decisions = zip(*entries)
            terminal = rewards[str(seat)]
            style_bonus = style_weight * style_score(result, seat, style)
            objective_terminal = terminal + style_bonus
            potentials = [morale_weight * morale_potential(d.get('learning')) if morale_weight else 0.
                          for d in decisions]
            next_advantage, next_value, next_potential = 0., 0., 0.
            for index in reversed(range(len(decisions))):
                decision = decisions[index]
                # The next observation of this seat includes intervening teammates'
                # and opponents' actions. This is a team signal, never individual blame.
                reward = (objective_terminal if index == len(decisions)-1 else 0.) + next_potential-potentials[index]
                if method == 'mc':
                    target = objective_terminal-potentials[index]
                    advantage = target-decision['old_value']
                else:
                    learning = decision.get('learning')
                    if learning is None:
                        raise ValueError('GAE requires root-request identity')
                    same_request = (index+1 < len(decisions)
                        and learning['requestId'] == decisions[index+1]['learning']['requestId'])
                    continuation = 1.0 if same_request else trace_lambda
                    delta = reward+next_value-decision['old_value']
                    advantage = delta+continuation*next_advantage
                    target = advantage+decision['old_value']
                game_rows[positions[index]] = {**decision, 'return': target, 'advantage': advantage,
                                  'terminal_return': terminal, 'style_bonus': style_bonus,
                                  'reward_style': style, 'potential': potentials[index],
                                  'source_seed': result.get('seed', game_id), 'game_id': game_id,
                                  'opponent': result.get('opponent', 'unknown'),
                                  'curriculum_kind': result.get('curriculumKind', 'full')}
                next_advantage, next_value, next_potential = advantage, decision['old_value'], potentials[index]
        rows.extend(game_rows)
    return rows


def value_diagnostics(rows):
    """Pre-update predictions vs actual wins, undoing the shaping baseline."""
    groups = {}
    for row in rows:
        styled = row.get('reward_style', 'win') != 'win'
        group = groups.setdefault(row['curriculum_kind'], dict(samples=0, squared_error=0.,
            value_semantics='style_return' if styled else 'terminal_win',
            calibration=[] if styled else [dict(count=0, predicted=0., won=0) for _ in range(5)]))
        prediction = row['old_value']+row['potential']
        group['samples'] += 1
        target = row['terminal_return'] + row.get('style_bonus', 0.)
        group['squared_error'] += (prediction-target)**2
        if not styled:
            probability = min(1., max(0., (prediction+1)/2))
            bucket = group['calibration'][min(4, int(probability*5))]
            bucket['count'] += 1
            bucket['predicted'] += probability
            bucket['won'] += int(row['terminal_return'] == 1)
    for group in groups.values():
        group['mse'] = group.pop('squared_error')/group['samples']
    return groups


def learner_sample_counts(rows):
    """Actual actor rows, including all six seats in self-play."""
    result = {}
    for row in rows:
        opponent = result.setdefault(row['opponent'], dict(samples=0, by_phase={}))
        opponent['samples'] += 1
        phase = row['curriculum_kind']
        opponent['by_phase'][phase] = opponent['by_phase'].get(phase, 0) + 1
    for opponent in result.values():
        opponent['fraction'] = opponent['samples'] / max(1, len(rows))
    return result


def parameter_groups(model):
    return dict(actor=list(model.actor.parameters())+list(model.score.parameters()),
                critic=list(model.critic.parameters())+list(model.value.parameters()))


def make_optimizers(model, actor_lr=1e-4, critic_lr=1e-4):
    return {key: torch.optim.AdamW(parameters, lr=lr)
            for (key, parameters), lr in zip(parameter_groups(model).items(), (actor_lr, critic_lr))}


def restore_optimizers(optimizers, saved, model):
    if 'actor' in saved:
        for key, optimizer in optimizers.items():
            optimizer.load_state_dict(saved[key])
        return
    # Map the old single optimizer's moments by actual model parameter identity.
    # Both state dictionaries have stable order from model.parameters().
    if len(saved['param_groups']) != 1:
        raise ValueError('Unsupported legacy optimizer groups')
    legacy_ids = saved['param_groups'][0]['params']
    parameters = list(model.parameters())
    if len(legacy_ids) != len(parameters):
        raise ValueError('Legacy optimizer/model mismatch')
    old_ids = {id(parameter): index for parameter, index in zip(parameters, legacy_ids)}
    for key, optimizer in optimizers.items():
        new = optimizer.state_dict()
        new_ids = new['param_groups'][0]['params']
        new['state'] = {new_id: saved['state'][old_ids[id(parameter)]]
                        for new_id, parameter in zip(new_ids, parameter_groups(model)[key])
                        if old_ids[id(parameter)] in saved['state']}
        optimizer.load_state_dict(new)
