const energy = player => player.energy.gem + player.energy.crystal;
const seals = player => player.heroState.bloodSeals ?? 0;
const spellCards = player => player.hand.filter(card => !card.reserve && card.type === 'spell');

// These are public-state forecasts, not rule execution. A continuation contains
// at most one Temperance action; newly drawn cards remain unknown.
export function selfHealing(state, id, amount, choices = null) {
  const player = state.players[id];
  const allowed = choices ?? Array.from({ length: Math.min(amount, player.healingDisabled ? 0 : player.healing) + 1 }, (_, n) => n);
  if (!allowed.length) return 0;
  if (player.heroState.form) return allowed.includes(0) ? 0 : Math.min(...allowed);
  const morale = state.teams[player.team].morale;
  const loss = healing => Math.max(0, player.count + amount - healing - player.limit);
  const safe = allowed.filter(healing => loss(healing) < morale);
  // One overflow enters Boiling Blood. Do not spend healing to prevent that
  // transition, but survival takes precedence when only one morale remains.
  const desired = loss(0) > 0 && morale > 1 ? 1 : 0;
  return [...(safe.length ? safe : allowed)].sort((a, b) =>
    Math.abs(loss(a) - desired) - Math.abs(loss(b) - desired) || a - b)[0];
}

export function selfDamage(state, id, amount, api) {
  if (api.terminal(state)) return;
  const player = state.players[id], before = state.teams[player.team].morale;
  api.applyDamage(state, id, amount, selfHealing(state, id, amount), 'spell', !player.heroState.form);
  if (!api.terminal(state) && state.teams[player.team].morale < before) player.heroState.form = 'boilingBlood';
}

export function endValue(state, id, api) {
  if (api.terminal(state) || !state.players[id].heroState.form) return api.evaluate(state);
  const next = api.copy(state), player = next.players[id];
  player.heroState.form = null;
  api.heal(next, id, 2);
  return api.evaluate(next);
}

export function healingTargetValue(player) {
  if (player.healing >= player.healingLimit) return -Infinity;
  const skills = player.skillIds ?? [];
  // These skills consume healing offensively. This does not assume their
  // owner's hidden hand contains the cards needed to execute them.
  const fuel = skills.includes('deathTouch') ? (player.healing === 1 ? 5 : 3) :
    skills.includes('heavenSpear') || skills.includes('earthSpear') ? (player.healing < 2 ? 4 : 2) : 0;
  const pressure = Math.max(0, player.count - (player.limit - 2));
  // Rose Garden disables damage prevention, not receiving/spending healing.
  return 2.5 + pressure * (player.healingDisabled ? .5 : 2) / (1 + player.healing) + fuel;
}

export function prayerState(state, id, count, api) {
  const next = api.copy(state), player = next.players[id];
  if (count < 1 || count > player.healing) return null;
  player.healing -= count;
  selfDamage(next, id, count, api);
  if (api.terminal(next)) return next;
  for (let n = 0; n < count; n++) {
    const target = next.players.filter(p => p.team === player.team && p.id !== id)
      .sort((a, b) => healingTargetValue(b) - healingTargetValue(a))[0];
    if (target && Number.isFinite(healingTargetValue(target))) api.heal(next, target.id, 1);
  }
  player.heroState.bloodSeals = Math.min(2, seals(player) + 1);
  if (next.turn) next.turn.activationDone = true;
  return next;
}

// A single inexpensive pair is enough for the local extra-action forecast.
// The main action catalogue still scores all its legal card choices normally.
function crossPlan(game, state, id, api) {
  const player = state.players[id];
  if (!seals(player) || !energy(player)) return null;
  const cards = spellCards(player).sort((a, b) =>
    api.cardCost(game, id, [game.cards.get(a.id)]) - api.cardCost(game, id, [game.cards.get(b.id)])).slice(0, 2);
  if (cards.length !== 2) return null;
  const paid = api.copy(state);
  api.payEnergy(paid, id, 1, 'crystal');
  api.spend(paid, id, cards);
  paid.players[id].heroState.bloodSeals--;
  selfDamage(paid, id, 4, api);
  const cost = api.cardCost(game, id, cards.map(card => game.cards.get(card.id)));
  if (api.terminal(paid)) return { value: api.evaluate(paid) - cost, mode: 'spell' };
  let best = null;
  for (const target of paid.players) {
    const next = api.copy(paid);
    api.hurt(next, target.id, 3, 'spell', { sourceId: id });
    const value = endValue(next, id, api) - cost;
    if (!best || value > best.value) best = { value, mode: 'spell', targetId: target.id };
  }
  return best;
}

function bestAction(game, state, id, api) {
  if (api.terminal(state)) return { value: api.evaluate(state), mode: null };
  const base = api.evaluate(state), player = state.players[id];
  const attack = api.bestAttackScore(game, id, state);
  // Ordinary spells cannot assume the two spell cards/energy needed by Cross.
  const ordinary = player.hand.some(c => c.type === 'spell' && c.name !== 'holyLight')
    ? api.bestSpellFollow(game, id, state) : -Infinity;
  const cross = crossPlan(game, state, id, api);
  const plans = [{ value: base, mode: null }];
  if (attack.card) plans.push({ value: base + attack.score, mode: 'attack' });
  if (Number.isFinite(ordinary)) plans.push({ value: base + ordinary, mode: 'spell' });
  if (cross) plans.push(cross);
  return plans.sort((a, b) => b.value - a.value)[0];
}

export function temperancePlan(game, state, id, api, { paid = false } = {}) {
  const player = state.players[id], stop = endValue(state, id, api);
  if (!paid && (!player.heroState.form || !energy(player) || api.terminal(state)))
    return { value: stop, use: false, mode: null };
  const next = api.copy(state);
  if (!paid) api.payEnergy(next, id, 1, 'crystal');
  next.players[id].heroState.form = null;
  // This detached flag bounds recursion through attackHitBonus. It never
  // enters the live Hero.state, engine observation, or network input.
  next.redLotusExtraPreview = true;
  const plan = bestAction(game, next, id, api);
  return { ...plan, use: !!plan.mode && (paid || plan.value > stop + .5) };
}

export function finishValue(game, state, id, api) {
  const stop = endValue(state, id, api);
  const player = state.players[id];
  if (api.terminal(state) || state.redLotusExtraPreview || !player.heroState.form || !energy(player)) return stop;
  const plan = temperancePlan(game, state, id, api);
  return plan.use ? plan.value : stop;
}

export function hitPlan(game, state, id, targetId, amount, api, { award = false, feast = true } = {}) {
  const player = state.players[id];
  const resolve = useFeast => {
    const next = api.copy(state);
    if (award) api.stones(next, player.team, 'gem', 1);
    if (useFeast) {
      next.players[id].heroState.bloodSeals--;
      selfDamage(next, id, 4, api);
    }
    if (!api.terminal(next)) api.hurt(next, targetId, amount + (useFeast ? 2 : 0), 'attack', { sourceId: id });
    return { state: next, useFeast, value: finishValue(game, next, id, api) };
  };
  const ordinary = resolve(false);
  if (!feast || !seals(player)) return { ...ordinary, baseline: ordinary.state };
  const boosted = resolve(true);
  return { ...(boosted.value > ordinary.value ? boosted : ordinary), baseline: ordinary.state };
}

export function prayerPlan(game, state, id, api, counts = null) {
  const before = bestAction(game, state, id, api).value;
  let best = { count: 0, gain: 0 };
  for (const count of counts ?? Array.from({ length: state.players[id].healing }, (_, n) => n + 1)) {
    const next = prayerState(state, id, count, api);
    if (!next) continue;
    const gain = bestAction(game, next, id, api).value - before;
    if (gain > best.gain) best = { count, gain };
  }
  return best;
}
