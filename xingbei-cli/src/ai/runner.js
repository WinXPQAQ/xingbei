import { resolveSync } from '../resolution/decisions.js';

// Sync compatibility entry with policy-local nested decisions, including overflow.
// A frozen policy must not inherit the production policy through Game's defaults.
export function runPolicyAction(policy, game, actorId, { autoRespond = true } = {}) {
  const action = policy.chooseAiAction(game, actorId);
  const options = { ai: true, autoRespond,
    overflow: (player, excess) => policy.chooseAiDiscard(game, player.id, excess),
    choose: request => policy.chooseAiRuleDecision(request, game) };
  const previous = game.automaticDecision;
  game.automaticDecision = request => {
    if(request.type==='response') {
      const enabled=typeof autoRespond==='function'?autoRespond(request.target.id):autoRespond;
      return enabled ? policy.chooseAiResponse(game,request) : null;
    }
    return policy.chooseAiRuleDecision(request,game);
  };
  try {
    if (action.type === 'refresh') game.refreshUnableHand(actorId, options);
    else if (action.type === 'purchase') game.purchase(actorId, options);
    else if (action.type === 'refine') game.refine(actorId, action.stones, options);
    else if (action.type === 'synthesize') game.synthesize(actorId, action.gemCount, options);
    else if (action.type === 'skill') resolveSync(game.skillActionSteps(actorId, action, options), request => game.automaticDecision(request, options));
    else if (action.type === 'play') game.play(actorId, action.index, action.targetId, options);
    else if (game.turn.hasExtraActions()) game.skipExtraActions(actorId);
    else game.log.push(`${game.player(actorId).name}跳过行动`);
    return action;
  } finally { game.automaticDecision = previous; }
}
