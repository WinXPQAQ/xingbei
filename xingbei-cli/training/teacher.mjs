import { getPolicy } from '../src/ai/versions.js';

const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => [key, item[key]])) : item);

// Explicit teacher/opponent mode only. Never used as a fallback for a model.
export function teacherIndex({ game, playerId, request, candidates }, version) {
  const policy = getPolicy(version);
  let value;
  if (request.type === 'action') value = policy.chooseAiAction(game, playerId);
  else if (request.type === 'response') value = policy.chooseAiResponse(game, request);
  else if (request.type === 'overflow') value = policy.chooseAiDiscard(game, playerId, game.player(playerId).hand.length - game.player(playerId).handLimit);
  else value = policy.chooseAiRuleDecision(request, game);
  const key = choice => {
    if (request.type === 'response' && choice != null) {
      const card = game.player(playerId).hand[choice.index];
      return canonical({ index: choice.index, targetId: card?.name === 'holyLight' ? null : choice.targetId ?? null });
    }
    if (['cardChoice', 'overflow'].includes(request.type) && Array.isArray(choice)) return canonical([...choice].sort((a,b) => a-b));
    return canonical(choice ?? null);
  };
  const index = candidates.findIndex(candidate => key(candidate) === key(value));
  if (index < 0) throw new Error(`Teacher ${version} returned unrepresented ${request.type}: ${canonical(value)}`);
  return index;
}
