const qi = player => player.heroState.swordQi ?? 0;
const energy = player => player.energy.gem + player.energy.crystal;
const soulMode = player => energy(player) > 0 && player.coveredCount > 0
  ? energy(player) % 2 ? 'angelSoul' : 'demonSoul' : null;
const addQi = (player, amount) => { player.heroState.swordQi = Math.min(5, qi(player) + amount); };
const soulReserveCost = player => player.heroState.soulPreview === 'demonSoul' ? 1.5 : 0;

// The original attack target is excluded by the rule. Other targets are scored
// by public pressure/healing, rather than fixed low-hand/high-hand categories.
function slashOptions(state, id, targetIds, amounts, api, optional = true) {
  const before = api.evaluate(state);
  let best = { amount: 0, targetId: null, score: optional ? 0 : -Infinity, state };
  for (const amount of amounts) {
    if (amount <= 0 || amount > Math.min(3, qi(state.players[id]))) continue;
    for (const targetId of targetIds) {
      const next = api.copy(state); next.players[id].heroState.swordQi -= amount;
      api.hurt(next, targetId, amount, 'spell');
      const score = api.evaluate(next) - before;
      if (score > best.score) best = { amount, targetId, score, state: next };
    }
  }
  return best;
}
function extraAttack(game, state, id, api) {
  const player = state.players[id];
  if (!energy(player) || api.terminal(state)) return 0;
  const next = api.copy(state);
  api.payEnergy(next, id, 1, 'crystal');
  // This is a non-damage draw: healing cannot pay for it or prevent overflow.
  api.draw(next, id, 1);
  if (!api.terminal(next)) addQi(next.players[id], 1);
  const continuation = api.terminal(next) ? 0 : api.bestAttackScore(game, id, next).score;
  // The drawn card stays unknown. Only attacks already known in hand are
  // searched; the real extra-action request will reconsider the actual draw.
  return api.evaluate(next) - api.evaluate(state) + continuation;
}
function soulDecision(a, api, mode) {
  const { context, state, id, game, request } = a;
  if (!context.card || context.targetId == null || soulMode(a.player) !== mode) return null;
  const score = variant => {
    const branches = api.attackOutcomes(game, id, state, context.card, context.targetId, { alreadyPlayed: true, variant });
    return api.scoreBranches(branches) + branches.reduce((sum, branch) => sum + branch.probability * (branch.bonus ?? 0), 0);
  };
  if (score(mode) <= score(false)) return null;
  return request.choices.filter(choice => game.cards.has(choice.value)).sort((x, y) =>
    api.cardScore(game, id, game.cards.get(x.value)) - api.cardScore(game, id, game.cards.get(y.value)))[0]?.value ?? null;
}
export const swordEmperorAi = {
  id: 'swordEmperor',
  energyPreference: 'crystal',
  acceptsRefine: () => true,
  cardBonus: ({ card, same }) => card.type === 'attack' ? (same ? 4 : 10) : -4,
  resourceValue(player) {
    // Marginal qi value drops near the cap: another miss should not be valued as
    // gaining a sixth point. A charge offers draw + qi + another attack.
    const qiValue = [0, 4, 7.5, 10.5, 12.5, 14][Math.min(5, qi(player))];
    const charges = energy(player);
    return qiValue + player.coveredCount * 3 + Math.min(1, charges) * 5 + Math.max(0, charges - 1) * 2;
  },
  refineBonus({ player }) {
    if (energy(player)) return 0;
    const attacks = player.hand.filter(card => card.type === 'attack').length;
    return Math.min(8, Math.min(2, attacks) * 2 + (player.coveredCount ? 2 : 0) + (qi(player) < 5 ? 2 : 0));
  },
  attackVariants: ({ player, active }) => active && soulMode(player) ? [false, soulMode(player)] : [false],
  prepareAttack({ player, active, variant }) {
    player.heroState.soulPreview = active && variant === soulMode(player) ? variant : null;
    if (player.heroState.soulPreview) player.coveredCount--;
  },
  attackDamage: ({ player, active }) => active && player.heroState.soulPreview === 'demonSoul' ? 1 : 0,
  beforeAttackHit({ state, id, targetId, active }, api) {
    if (!active) return;
    const targets = state.players.filter(p => p.id !== targetId).map(p => p.id);
    const best = slashOptions(state, id, targets, [1, 2, 3], api);
    if (best.amount) Object.assign(state, best.state);
    const player = state.players[id];
    // Sword qi resolves before either soul and before the attack damage. A win
    // from the slash stops the remaining effects in this forecast as in play.
    if (!api.terminal(state) && player.heroState.soulPreview === 'angelSoul' && !player.healingDisabled) api.heal(state, id, 2);
  },
  afterAttackMiss({ state, player, active }) {
    if (!active) return;
    addQi(player, 1);
    if (!player.heroState.soulPreview) player.coveredCount = Math.min(3, player.coveredCount + 1);
    else if (player.heroState.soulPreview === 'angelSoul') state.teams[player.team].morale = Math.min(15, state.teams[player.team].morale + 1);
    else addQi(player, 2);
  },
  // A small opportunity cost favors retaining a soul for its odd-energy mode;
  // lethal damage or a useful qi gain can still outweigh this preference.
  attackHitBonus: ({ player, active }) => active ? -soulReserveCost(player) : 0,
  attackMissBonus: ({ player, active }) => active ? -soulReserveCost(player) : 0,
  followAttackScore({ game, id, active, branches }, api) {
    if (!active) return 0;
    return branches.reduce((sum, branch) => sum + branch.probability * Math.max(0, extraAttack(game, branch.state, id, api)), 0);
  },
  decisions: {
    angelSoul: (a, api) => soulDecision(a, api, 'angelSoul'),
    demonSoul: (a, api) => soulDecision(a, api, 'demonSoul'),
    unyielding: (a, api) => extraAttack(a.game, a.state, a.id, api) > 0,
    swordQiSlash(a, api) {
      if (a.request.type === 'playerChoice') return slashOptions(a.state, a.id,
        a.request.choices.map(choice => choice.value), [a.context.amount ?? 1], api, false).targetId ?? a.request.defaultValue;
      const targets = a.state.players.filter(p => p.id !== a.context.targetId).map(p => p.id);
      return slashOptions(a.state, a.id, targets, a.request.choices.map(choice => choice.value), api).amount;
    },
  },
};
