import { createDeck } from '../../cards.js';
import { probability } from '../shared/ai/base/planner.js';

// Printed-card frequencies only. Brawl reveals at least one card, at most three;
// no future deck order is inspected to value a favorable gamble.
const printed = createDeck();
const continuation = printed.filter(card => card.type === 'spell' || card.fates.includes('X')).length / printed.length;
export const brawlOutcomes = Object.freeze([
  { amount: 3, weight: 1 - continuation },
  { amount: 4, weight: continuation * (1 - continuation) },
  { amount: 5, weight: continuation ** 2 },
]);
export const bladeBonus = (card, count, active) => active && card.uniqueSkills?.includes('bloodBlade') ? count === 2 ? 2 : count === 3 ? 1 : 0 : 0;

export function brawlHitValue(state, id, targetId, card, active, api) {
  const bonus = bladeBonus(card, state.players[targetId].count, active);
  return brawlOutcomes.reduce((sum, branch) => sum + branch.weight * api.damageGain(state, id, targetId, branch.amount + bonus, 'attack'), 0);
}

export function roarOpportunity(state, id, targetId, card, api) {
  const target = state.players[targetId];
  if (!card.uniqueSkills?.includes('bloodyRoar') || target.healing <= 0 || target.effects.some(effect => effect.name === 'holyShield')) return 0;
  const elements = card.traits?.[id]?.elements ?? card.elements;
  const gaps = state.beliefs?.[targetId] ?? {};
  const same = printed.filter(c => c.type === 'attack' && c.name !== 'darkStrike' && c.elements.some(element => elements.includes(element))).length / printed.length;
  const counterRate = same * (1 - Math.min(...elements.map(element => gaps[element] ?? 0)));
  const restrictedHit = (1 - counterRate) ** target.count;
  const ordinary = probability(state, id, card, targetId).hit;
  // Same-element responses remain legal. The gain comes from removing light /
  // dark defenses, not from declaring the attack uncounterable or guaranteed.
  return Math.max(0, restrictedHit - ordinary) * Math.max(0, brawlHitValue(state, id, targetId, card, true, api) + 4);
}
