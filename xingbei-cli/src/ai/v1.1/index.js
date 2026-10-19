import { isolatePolicy } from '../observation.js';
import * as baseline from '../v1.0/index.js';
import { readingAdjustment } from './reading.js';
import { chooseDefense } from './defense.js';
import { heroAdjustment } from './threats.js';
export function createPolicy({ reading = true, readingWeight = 1, history = true, defense = false, heroes = false } = {}) {
  return isolatePolicy({
    ...baseline,
    chooseAiResponse: defense ? (game, request) => chooseDefense(game, request, { heroThreats: heroes }) : baseline.chooseAiResponse,
    rankAiActions(game, actorId) {
      return baseline.rankAiActions(game, actorId).map(entry => {
        const card = entry.action.type === 'play' ? game.player(actorId).hand[entry.action.index] : null;
        const adjustment = reading && card?.type === 'attack' ? readingAdjustment(game, actorId, card, entry.action.targetId, readingWeight, history) : 0;
        const heroBonus = heroes && card?.type === "attack" ? heroAdjustment(game, actorId, card, entry.action.targetId) : 0;
        return { ...entry, score: entry.score + adjustment + heroBonus, readingAdjustment: adjustment, heroAdjustment: heroBonus };
      }).sort((a, b) => b.score - a.score);
    },
    chooseAiAction(game, actorId) { return this.rankAiActions(game, actorId)[0].action; },
  }, { history });
}
const policy = createPolicy();
export const rankAiActions = (game, id) => policy.rankAiActions(game, id);
export const chooseAiAction = (game, id) => policy.chooseAiAction(game, id);

export const { chooseAiDiscard, cardScore, keepCards, giftScore, planWindAttacks, chooseAiResponse, chooseAiRuleDecision } = policy;
