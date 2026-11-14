import { damageTarget, cheapCards } from '../shared/ai/decisions.js';
import { playableCards } from '../../playable-cards.js';
import { heroAi } from '../shared/ai/wave-three/registry.js';

const bestHealing = (state, api) => Math.max(0, ...state.players.map(target => {
  if (target.healingDisabled || target.healing >= target.healingLimit) return 0;
  const next = api.copy(state); api.heal(next, target.id, 1);
  return api.evaluate(next) - api.evaluate(state);
}));
const bestDamage = (state, id, amount, api) => Math.max(0, ...state.players.map(p => api.damageGain(state, id, p.id, amount)));
function blessingEnd(state, id, api) {
  const p = state.players[id];
  return p.heroState.form && !p.coveredCount ? bestDamage(state, id, 2, api) : 0;
}
// One optional extra attack, including the ending spell if it spends the last
// blessing. Reconsider targets after the first attack; do not reuse its arrow.
function windContinuation(game, state, id, api) {
  const next = api.copy(state);
  next.players[id].heroState.arrowPreview = null;
  const before = api.evaluate(next);
  let best = blessingEnd(next, id, api);
  for (const card of next.players[id].hand.filter(c => c.type === 'attack')) {
    const live = game.cards.get(card.id), price = live ? api.cardCost(game, id, [live]) : 0;
    for (const target of api.foes(next, id)) {
      if (heroAi(target.hero).blocksActiveAttack?.(target)) continue;
      const branches = api.attackOutcomes(game, id, next, card, target.id);
      if (!branches.length) continue;
      const score = branches.reduce((sum, b) => sum + b.probability *
        (api.evaluate(b.state) + (b.bonus ?? 0)
          + (api.terminal(b.state) ? 0 : blessingEnd(b.state, id, api))), 0) - before - price;
      best = Math.max(best, score);
    }
  }
  return best;
}
function arrowOutcomes(game, state, id, card, targetId, element, api) {
  const next = api.copy(state), p = next.players[id];
  p.heroState.elementShotUsed = true;
  p.heroState.arrowPreview = element;
  const branches = api.attackOutcomes(game, id, next, card, targetId, { alreadyPlayed: true });
  return branches.reduce((sum, b) => sum + b.probability *
    (api.evaluate(b.state) + (b.bonus ?? 0) + (api.terminal(b.state) ? 0
      : element === 'wind' ? windContinuation(game, b.state, id, api)
        : blessingEnd(b.state, id, api))), 0);
}
// Compare the same attack with/without an arrow. Payment can free hand space or
// consume a playable blessing; only the last blessing unlocks the ending spell.
function arrowOptions({ game, state, id, card, targetId, alreadyPlayed = false }, api) {
  const player = state.players[id];
  if (!card || targetId == null || player.heroState.elementShotUsed) return [];
  const elements = (card.traits?.[id]?.elements ?? card.elements ?? []).filter(e => e !== 'dark');
  if (!elements.length) return [];
  const before = api.copy(state);
  if (!alreadyPlayed) {
    const selected = before.players[id].hand.find(c => c.id === card.id);
    if (!selected) return [];
    api.spend(before, id, [selected]);
  }
  const baseline = arrowOutcomes(game, before, id, card, targetId, null, api);
  const options = [];
  for (const cost of before.players[id].hand.filter(c => c.reserve || c.type === 'spell')) {
    const next = api.copy(before); api.spend(next, id, [cost]);
    const live = game.cards.get(cost.id), price = live ? api.cardCost(game, id, [live]) : 0;
    for (const element of elements) {
      const score = arrowOutcomes(game, next, id, card, targetId, element, api) - baseline - price;
      options.push({ cost: cost.id, payment: cost.reserve ? 'blessing' : 'spell', element, score });
    }
  }
  return options.sort((a, b) => b.score - a.score);
}
function currentArrow(a, api) {
  const card = a.context.card, traits = a.context.attackTraits;
  return arrowOptions({ ...a, card: card && traits ? { ...card, traits: { ...card.traits, [a.id]: traits } } : card,
    targetId: a.context.targetId, alreadyPlayed: true }, api);
}
function exchangeGain(state, id, targetId, api) {
  const next = api.copy(state);
  api.draw(next, targetId, 1);
  if (!api.terminal(next)) api.discardEstimate(next, targetId, 1);
  return api.evaluate(next) - api.evaluate(state) + (targetId === id && state.players[id].count < state.players[id].limit ? 1.5 : 0);
}
export const elfArcherAi = {
  id: 'elfArcher',
  energyPreference: 'gem', usefulCrystals: 1,
  cardBonus: ({ card, retained, same, elements }) => card.type === 'spell'
    ? (retained.filter(c => c.type === 'spell').length < 1 ? 13 : 0)
    : !same ? (elements.some(e => ['wind', 'thunder'].includes(e)) ? 15 : 8) : 0,
  resourceValue: p => p.coveredCount * 5 + p.energy.gem * (p.heroState.form ? 2 : 5) + Math.min(1, p.energy.crystal) * 2,
  refineBonus: ({ player, gem }) => gem && !player.heroState.form && !player.energy.gem ? 6 : 0,
  uncounterable: ({ player, active }) => active && player.heroState.arrowPreview === 'thunder',
  attackDamage: ({ player, active }) => active && player.heroState.arrowPreview === 'fire' ? 1 : 0,
  attackHitBonus({ state, id, player, active }, api) {
    if (!active) return 0;
    return player.heroState.arrowPreview === 'water' ? bestHealing(state, api)
      : player.heroState.arrowPreview === 'earth' ? bestDamage(state, id, 1, api) : 0;
  },
  actionBonus({ game, state, id, action }, api) {
    const card = action.type === 'play' ? playableCards(game.player(id))[action.index] : null;
    if (!card) return 0;
    const next = api.copy(state), selected = next.players[id].hand.find(c => c.id === card.id);
    if (selected) api.spend(next, id, [selected]);
    const finish = blessingEnd(next, id, api) - blessingEnd(state, id, api);
    return finish + (card.type === 'attack' ? Math.max(0, arrowOptions({ game, state, id, card, targetId: action.targetId }, api)[0]?.score ?? 0) : 0);
  },
  decisions: {
    elfRitual: () => true,
    elfRitualEnd: (a, api) => damageTarget(a, api, 2),
    earthArrow: (a, api) => damageTarget(a, api, 1),
    elementShot(a, api) {
      const best = currentArrow(a, api).find(option => a.request.choices.some(c => c.value === option.payment));
      return best?.score > 0 ? best.payment : 'skip';
    },
    elementShotCost(a, api) {
      const best = currentArrow(a, api).find(option => option.payment === 'spell' && a.request.valid.some(i => a.source.hand[i].id === option.cost));
      return best ? [a.source.hand.findIndex(card => card.id === best.cost)] : cheapCards(a, api);
    },
    elementShotBlessing(a, api) {
      const ranked = currentArrow(a, api).filter(option => option.payment === 'blessing' && a.request.choices.some(c => c.value === option.cost));
      return ranked[0]?.cost ?? [...a.request.choices].sort((x, y) =>
        api.cardScore(a.game, a.id, a.game.cards.get(x.value)) - api.cardScore(a.game, a.id, a.game.cards.get(y.value)))[0]?.value;
    },
    elementArrow(a, api) {
      const card = a.context.card, targetId = a.context.targetId;
      if (!card || targetId == null) return a.request.defaultValue;
      return [...a.request.choices].sort((x, y) =>
        arrowOutcomes(a.game, a.state, a.id, card, targetId, y.value, api) - arrowOutcomes(a.game, a.state, a.id, card, targetId, x.value, api))[0]?.value;
    },
    animalCompanion(a, api) {
      if (a.request.type !== 'skillChoice') return undefined;
      const own = exchangeGain(a.state, a.id, a.id, api);
      const best = Math.max(...a.state.players.map(p => exchangeGain(a.state, a.id, p.id, api)));
      return own > 0 || (a.player.energy.gem + a.player.energy.crystal > 0 && best > 5);
    },
    petEnhancement(a, api) {
      const candidates = (a.request.type === 'playerChoice' ? a.request.choices.map(c => c.value) : a.state.players.map(p => p.id))
        .map(id => ({ id, score: exchangeGain(a.state, a.id, id, api) })).sort((x, y) => y.score - x.score);
      return a.request.type === 'playerChoice' ? candidates[0]?.id
        : candidates[0].score > exchangeGain(a.state, a.id, a.id, api) + 5;
    },
  },
};
