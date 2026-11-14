const spirit = player => player.heroState.spirit ?? 0;
const enemies = (state, id) => state.players.filter(p => p.team !== state.players[id].team);

// Soft route preference from public pressure and safe opportunities to grow.
// Opposing heroes are not classified and hidden response cards stay unknown.
function dragonPotential(state, id) {
  const p = state.players[id];
  const pressure = Math.max(0, ...enemies(state, id).map(target =>
    Math.min(1, Math.max(0, target.count + 4 - target.healing - target.limit) / 4)));
  const safety = enemies(state, id).some(target => target.healing > 0) ? 1 :
    Math.min(1, (p.healing + Math.max(0, p.limit - p.count)) / 4);
  return pressure * safety;
}
function routeValue(state, id) {
  const p = state.players[id];
  return dragonPotential(state, id) * (Math.min(6, spirit(p)) * 2 + (p.heroState.form ? 4 : 0));
}
function recoil(state, id, api) {
  if (!api.terminal(state)) api.hurt(state, id, Math.min(4, spirit(state.players[id])), 'spell');
}
function attackChoice(a, api) {
  const card = a.context.card, targetId = a.context.targetId;
  if (!card || targetId == null) return null;
  const variants = a.request.skillId === 'stunningBlow' ? ['ordinary', 'stunning'] :
    ['ordinary', ...(spirit(a.player) < 6 && !a.player.heroState.form ? ['charged'] : []), ...(spirit(a.player) > 0 ? ['stunning'] : [])];
  return variants.map(variant => {
    const branches = api.attackOutcomes(a.game, a.id, a.state, card, targetId, { active: true, alreadyPlayed: true, variant });
    const score = api.scoreBranches(branches) + branches.reduce((sum, branch) => sum + branch.probability * routeValue(branch.state, a.id), 0);
    return { variant, score };
  }).sort((a, b) => b.score - a.score)[0]?.variant;
}
function bulletOptions(state, id, api, increase = true) {
  if (increase && spirit(state.players[id]) >= 6) return [];
  return enemies(state, id).map(target => {
    const next = api.copy(state), p = next.players[id];
    if (increase) p.heroState.spirit++;
    api.hurt(next, target.id, 1, 'spell');
    if (target.healing === 0) recoil(next, id, api);
    return { targetId: target.id, score: api.evaluate(next) - api.evaluate(state) + routeValue(next, id) - routeValue(state, id) };
  }).sort((a, b) => b.score - a.score);
}
function dragonPreparation(state, id, api) {
  const next = api.copy(state), p = next.players[id];
  p.heroState.spirit -= 3;
  p.heroState.form = 'dragonFist'; p.heroState.lockedTarget = null;
  return next;
}
function bodyPreparation(game, state, id, api, action = null) {
  const next = api.copy(state), p = next.players[id], hand = game.player(id).hand;
  api.payEnergy(next, id, 1, 'crystal');
  const reserved = new Set(action?.cardIds ?? []);
  if (action?.type === 'play') reserved.add(hand[action.index]?.id);
  const valid = hand.map((card, index) => ({ card, index })).filter(({ card }) => !reserved.has(card.id)).map(({ index }) => index);
  const count = Math.max(0, p.count - 3);
  if (count > valid.length) return null;
  const removed = api.chooseAiDiscard(game, id, count, valid).map(index => p.hand.find(card => card.id === hand[index].id)).filter(Boolean);
  api.remove(next, id, removed); api.heal(next, id, 2);
  return next;
}

export const fighterAi = {
  id: 'fighter', acceptsRefine: () => true, energyPreference: 'crystal',
  resourceValue: p => Math.min(2, spirit(p)) * 2 - Math.max(0, spirit(p) - 2) * 1.5 +
    (p.heroState.form ? 5 : 0) + Math.min(1, p.energy.gem + p.energy.crystal) * 6,
  refineBonus: ({ state, player }) => !player.energy.gem && !player.energy.crystal &&
    state.teams[player.team].gem + state.teams[player.team].crystal >= 4 ? 7 : 0,
  cardBonus: ({ card, retained }) => card.type === 'attack' ? 12 :
    retained.filter(c => c.type === 'spell' && c.name !== 'holyLight').length >= 2 ? -8 : 0,
  attackVariants: ({ player, active }) => !active ? ['ordinary'] :
    ['ordinary', ...(!player.heroState.form && spirit(player) < 6 ? ['charged'] : []), ...(spirit(player) > 0 ? ['stunning'] : [])],
  prepareAttack({ player, active, targetId, variant }) {
    if (!active) return;
    if (player.heroState.form && player.heroState.lockedTarget != null && player.heroState.lockedTarget !== targetId) {
      player.heroState.form = null; player.heroState.lockedTarget = null;
    }
    if (player.heroState.form) player.heroState.lockedTarget = targetId;
    player.heroState.attackPreview = variant;
    if (variant === 'charged') player.heroState.spirit++;
    if (variant === 'stunning') player.heroState.spirit--;
  },
  attackDamage: ({ player, active }) => (player.heroState.form ? active ? 2 : 1 : 0) +
    Number(active && player.heroState.attackPreview === 'charged'),
  uncounterable: ({ active, variant }) => active && variant === 'stunning',
  afterAttackMiss({ state, id, active, variant }, api) {
    if (active && variant === 'charged') recoil(state, id, api);
  },
  afterAttackResolved({ state, id, active, variant }, api) {
    if (active && variant === 'stunning') recoil(state, id, api);
  },
  followAttackScore({ state, id, active, branches }) {
    return active ? branches.reduce((sum, branch) => sum + branch.probability * (routeValue(branch.state, id) - routeValue(state, id)), 0) : 0;
  },
  preparations({ game, state, id, player, card, action, options }, api) {
    const starts = [{ state, activated: null }];
    if (card?.type === 'attack' && !player.heroState.form && spirit(player) >= 3)
      starts.push({ state: dragonPreparation(state, id, api), activated: 'hundredDragonFist' });
    for (const start of starts) {
      if (start.activated) options.push(start);
      if (player.energy.gem + player.energy.crystal <= 0) continue;
      const prepared = bodyPreparation(game, start.state, id, api, action);
      if (prepared) options.push({ state: prepared, activated: start.activated ?? 'warGodBody' });
    }
    return options;
  },
  actionBonus({ game, state, id, player, action }, api) {
    const card = action.type === 'play' ? game.player(id).hand[action.index] : null;
    if (card?.type === 'attack') return 0;
    const next = api.copy(state);
    if (player.heroState.form) { next.players[id].heroState.form = null; next.players[id].heroState.lockedTarget = null; }
    let score = api.evaluate(next) - api.evaluate(state);
    if (card?.type === 'spell') {
      const selected = next.players[id].hand.find(c => c.id === card.id);
      if (selected) api.remove(next, id, [selected]);
      score += Math.max(0, bulletOptions(next, id, api)[0]?.score ?? 0);
    }
    return score;
  },
  decisions: {
    chargedStrike: (a, api) => attackChoice(a, api) === 'charged',
    stunningBlow: (a, api) => attackChoice(a, api) === 'stunning',
    hundredDragonFist({ game, state, id, player, request }, api) {
      if (request.type !== 'skillChoice') return undefined;
      if (player.heroState.form || spirit(player) < 3) return false;
      const next = dragonPreparation(state, id, api);
      return api.evaluate(next) - api.evaluate(state) + api.bestAttackScore(game, id, next).score - api.bestAttackScore(game, id, state).score > 0;
    },
    warGodBody({ game, state, id, request }, api) {
      if (request.type !== 'skillChoice') return undefined;
      const next = bodyPreparation(game, state, id, api);
      return next && api.evaluate(next) > api.evaluate(state);
    },
    spiritBullet({ state, id, request }, api) {
      const choices = bulletOptions(state, id, api, request.type !== 'playerChoice');
      const best = request.type === 'playerChoice' ? choices.find(option => request.choices.some(choice => choice.value === option.targetId)) : choices[0];
      return request.type === 'skillChoice' ? (best?.score ?? 0) > 0 : best?.targetId ?? request.defaultValue;
    },
  },
};
