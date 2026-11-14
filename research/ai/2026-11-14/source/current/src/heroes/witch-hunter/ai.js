import { damageTarget } from '../shared/ai/decisions.js';
import { probability } from '../shared/ai/base/planner.js';

function captureValue(state, id, targetId, api) {
  if (state.players[id].coveredCount >= 4 || !state.players[targetId].count) return -Infinity;
  const next = api.copy(state);
  api.discardEstimate(next, targetId, 1); next.players[id].coveredCount++;
  return api.evaluate(next) - api.evaluate(state);
}
function captureTargets(state, id, api, ids = state.players.map(p => p.id)) {
  return ids.map(targetId => ({ targetId, score: captureValue(state, id, targetId, api) })).sort((a, b) => b.score - a.score);
}
function stingValue({ state, id, context }, api) {
  const p = state.players[id], target = state.players[context.targetId];
  if (!target || target.count <= 0 || target.count >= 4 || p.coveredCount >= 4) return 0;
  const immediate = captureValue(state, id, target.id, api);
  if (p.coveredCount < 3) return immediate;
  const allied = captureTargets(state, id, api, state.players.filter(t => t.team === p.team).map(t => t.id))[0]?.score ?? 0;
  const hit = context.card ? probability(state, id, context.card, target.id).hit : .5;
  // The fourth bottle closes spellStrip. Preserve that slot when the expected
  // relief for a pressured ally is worth more than this low-hand capture.
  return immediate - hit * Math.max(0, allied);
}
function pairOptions(a, api) {
  const { source, game, id, state } = a;
  const bottles = source.covered.filter(c => c.location.pile === 'manaBottle');
  const allowed = new Set(a.request.choices.map(c => c.value));
  const selected = a.context.selectedCardIds ?? bottles.filter(c => !allowed.has(c.id)).map(c => c.id);
  const grouped = new Map();
  for (let i = 0; i < bottles.length; i++) for (let j = i + 1; j < bottles.length; j++) {
    const pair = [bottles[i], bottles[j]];
    if (!selected.every(id => pair.some(c => c.id === id))) continue;
    const spells = pair.filter(c => c.type === 'spell').length;
    const same = pair[0].getTraits({ playerId: id }).elements.some(e => pair[1].getTraits({ playerId: id }).elements.includes(e));
    const price = pair.reduce((sum, card) => sum + api.cardScore(game, id, card) / 70, 0);
    const key = `${spells}:${same}`;
    if (!grouped.has(key) || price < grouped.get(key).price) grouped.set(key, { pair, spells, same, price });
  }
  return [...grouped.values()].map(option => {
    const next = api.copy(state); next.players[id].coveredCount -= 2;
    next.players[id].heroState.ambushUsed = true;
    api.payEnergy(next, id, 1, 'crystal');
    let extra = 0;
    if (!option.spells) extra = api.bestAttackScore(game, id, next).score;
    const chosen = new Set();
    for (let i = 0; i < option.spells && !api.terminal(next); i++) {
      const target = next.players.filter(p => p.team !== a.player.team && !chosen.has(p.id))
        .map(p => ({ id: p.id, score: api.damageGain(next, id, p.id, 1) })).sort((x, y) => y.score - x.score)[0];
      if (target) { chosen.add(target.id); api.hurt(next, target.id, 1); }
    }
    if (option.same && !api.terminal(next)) {
      const target = next.players.map(p => ({ id: p.id, score: api.damageGain(next, id, p.id, 1) })).sort((x, y) => y.score - x.score)[0];
      api.hurt(next, target.id, 1);
    }
    return { ...option, score: api.evaluate(next) - api.evaluate(state) + extra - option.price };
  }).sort((x, y) => y.score - x.score);
}
function venomOptions(a, api) {
  const { state, id, context, game } = a, targetId = context.targetId, actual = context.actual ?? 0;
  if (targetId == null || actual <= 0) return [];
  const before = api.copy(state);
  api.applyActualDamage(before, targetId, actual, context.damageType ?? 'attack');
  return a.request.choices.filter(choice => game.cards.has(choice.value)).map(choice => {
    const card = game.cards.get(choice.value), next = api.copy(state);
    next.players[id].coveredCount--;
    api.applyActualDamage(next, targetId, actual - 1, context.damageType ?? 'attack');
    if (!api.terminal(next)) {
      next.players[targetId].count++; api.overflow(next, targetId);
      if (!api.terminal(next)) api.heal(next, id, 1);
    }
    // The bottle replaces an unknown draw. Estimate its recipient-specific
    // usefulness from public hero abilities, never from their hidden hand.
    const quality = (api.cardScore(game, targetId, card) - 72) / 24;
    const sign = state.players[targetId].team === a.player.team ? 1 : -1;
    const space = state.players[id].coveredCount === 4 && !api.terminal(next)
      ? Math.max(0, captureTargets(next, id, api)[0]?.score ?? 0) / 4 : 0;
    return { card: card.id, score: api.evaluate(next) - api.evaluate(before) + sign * quality + space };
  }).sort((x, y) => y.score - x.score);
}
export const witchHunterAi = {
  id: 'witchHunter',
  energyPreference: 'crystal',
  cardBonus: ({ card, retained }) => card.type === 'spell' && retained.filter(c => c.type === 'spell').length < 3 ? 12 : 0,
  resourceValue: p => (p.coveredCount ?? 0) * 3 + (p.energy.gem + p.energy.crystal) * (p.coveredCount >= 2 ? 4 : 1),
  refineBonus: ({ crystal, player, state }) => {
    const team = state.teams[player.team], racing = team.cups >= 3 && team.gem + team.crystal >= 3;
    return crystal && !player.energy.crystal && !racing ? (player.coveredCount >= 2 ? 5 : 2) : 0;
  },
  attackHitBonus({ state, id, active }, api) {
    return active ? Math.max(0, captureTargets(state, id, api)[0]?.score ?? 0) : 0;
  },
  prepareAttack({ state, id, card, targetId, active }, api) {
    if (active && stingValue({ state, id, context: { card, targetId } }, api) > 0) {
      api.discardEstimate(state, targetId, 1);
      state.players[id].coveredCount++;
    }
  },
  scoreSkill({ game, state, next, id, skillId, costs, targetId }, api) {
    if (skillId !== 'spellConversion') return null;
    const card = game.cards.get(costs[0].id);
    const converted = { ...card, name: `${card.getTraits({ playerId: id }).elements[0]}Strike`, type: 'attack', uniqueSkills: [] };
    return api.attackScore(game, id, state, converted, targetId) + api.evaluate(state) - api.evaluate(next) + api.cardCost(game, id, [card]);
  },
  decisions: {
    witchSting: (a, api) => stingValue(a, api) > 0,
    spellStrip: (a, api) => (captureTargets(a.state, a.id, api)[0]?.score ?? 0) > 0,
    spellStripTarget: (a, api) => captureTargets(a.state, a.id, api, a.request.choices.map(c => c.value))[0]?.targetId ?? a.request.defaultValue,
    silverVenom(a, api) { const best = venomOptions(a, api)[0]; return best?.score > 0 ? best.card : null; },
    ambush(a, api) {
      const best = pairOptions(a, api)[0];
      if (!best || (a.request.optional && best.score <= 0)) return null;
      return best.pair.find(card => a.request.choices.some(choice => choice.value === card.id))?.id ?? a.request.defaultValue;
    },
    ambushTargets: damageTarget,
    ambushSame: damageTarget,
  },
};
