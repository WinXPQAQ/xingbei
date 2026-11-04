import { getPolicy } from '../src/ai/versions.js';

const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => [key, item[key]])) : item);

// Explicit teacher/opponent mode only. Never used as a fallback for a model.
export function teacherIndex({ game, playerId, request, candidates }, version) {
  if (request.required && candidates.length === 1) return 0;
  if (request.skillId === 'activationRoute') return candidates.indexOf(request.defaultValue);
  if (request.blockedReason) return candidates.indexOf(false);
  const policy = getPolicy(version);
  let value;
  if (request.type === 'action') {
    value = policy.chooseAiAction(game, playerId);
    // Frozen opponents planned a concrete normal action before activation.
    // Preserve their route preference, then ask them again after activation.
    if (candidates.some(c => c.type === 'activate') && (['play','activate'].includes(value?.type) || (value?.type === 'skill' && game.skillActionSpec(playerId,value)?.type !== 'special'))) value = { type: 'activate' };
  }
  else if (request.type === 'response') value = policy.chooseAiResponse(game, request);
  else if (request.type === 'overflow') value = policy.chooseAiDiscard(game, playerId, game.player(playerId).hand.length - game.player(playerId).handLimit);
  else value = policy.chooseAiRuleDecision(request, game);
  // The engine interprets every non-draw weakness answer as skipping. Some
  // newer policies return null; record the executed command, not a new fallback.
  if (request.type === 'weakness' && value !== 'draw') value = 'skip';
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
