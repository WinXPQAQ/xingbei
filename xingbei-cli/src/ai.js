// Shared production policy for CLI, browser and automatic engine decisions.
import { getPolicy } from "./ai/versions.js";
export const AI_POLICY_VERSION = "v1.3";
const policy = getPolicy(AI_POLICY_VERSION);
export const rankAiActions = (game, actorId) => policy.rankAiActions(game, actorId);
export const chooseAiAction = (game, actorId) => policy.chooseAiAction(game, actorId);
export const chooseAiResponse = policy.chooseAiResponse;
export const chooseAiRuleDecision = policy.chooseAiRuleDecision;
export const chooseAiDiscard = policy.chooseAiDiscard;
export const cardScore = policy.cardScore;
export const keepCards = policy.keepCards;
export const giftScore = policy.giftScore;
export const planWindAttacks = policy.planWindAttacks;
export const runAiAction = (game, actorId, options) => policy.runAiAction(game, actorId, options);
