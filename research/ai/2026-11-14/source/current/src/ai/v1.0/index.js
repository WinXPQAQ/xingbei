import { resolveSync } from "../../resolution/decisions.js";
import { rankAiActions } from "./actions.js";
import { chooseAiRuleDecision } from "./decisions.js";
export { rankAiActions } from "./actions.js";
export { chooseAiResponse, chooseAiRuleDecision } from "./decisions.js";
export { cardScore, chooseAiDiscard, keepCards, giftScore } from "./evaluation.js";
export { planWindAttacks } from "./wind-plan.js";

export function chooseAiAction(game, actorId) { return rankAiActions(game, actorId)[0].action; }

export function runAiAction(game, actorId, { autoRespond = true } = {}) {
  const action = chooseAiAction(game, actorId);
  const options = { autoRespond, ai: true, overflow: "ai", choose: request => chooseAiRuleDecision(request, game) };
  if (action.type === "refresh") game.refreshUnableHand(actorId, options);
  else if (action.type === "purchase") game.purchase(actorId, options);
  else if (action.type === "refine") game.refine(actorId, action.stones, options);
  else if (action.type === "synthesize") game.synthesize(actorId, action.gemCount, options);
  else if (action.type === "skill") resolveSync(game.skillActionSteps(actorId, action, options), request => game.automaticDecision(request, options));
  else if (action.type === "play") game.play(actorId, action.index, action.targetId, options);
  else if (game.turn.hasExtraActions()) game.skipExtraActions(actorId);
  else game.log.push(`${game.player(actorId).name}跳过行动`);
  return action;
}
