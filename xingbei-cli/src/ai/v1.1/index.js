import * as baseline from '../v1.0/index.js';
import { readingAdjustment } from './reading.js';
export { chooseAiDiscard, cardScore, keepCards, giftScore, planWindAttacks } from '../v1.0/index.js';
export const chooseAiResponse = baseline.chooseAiResponse;
export const chooseAiRuleDecision = baseline.chooseAiRuleDecision;
export function createPolicy({ reading = true, readingWeight = 1 } = {}) {
  return {
    ...baseline,
    rankAiActions(game, actorId) {
      return baseline.rankAiActions(game, actorId).map(entry => {
        const card = entry.action.type === 'play' ? game.player(actorId).hand[entry.action.index] : null;
        const adjustment = reading && card?.type === 'attack' ? readingAdjustment(game, actorId, card, entry.action.targetId, readingWeight) : 0;
        return { ...entry, score: entry.score + adjustment, readingAdjustment: adjustment };
      }).sort((a, b) => b.score - a.score);
    },
    chooseAiAction(game, actorId) { return this.rankAiActions(game, actorId)[0].action; },
  };
}
const policy = createPolicy();
export const rankAiActions = (game, id) => policy.rankAiActions(game, id);
export const chooseAiAction = (game, id) => policy.chooseAiAction(game, id);
