import { getPolicy } from '../src/ai/versions.js';
import { createLegacyPolicy, LEGACY_POLICY } from './legacy/policy.mjs';
import { AI_POLICY_VERSION } from '../src/ai.js';
import { allowsMagicArcherAiAction } from '../src/heroes/magic-archer/ai.js';
let legacy;
const teachingPolicy = version => version === LEGACY_POLICY ? (legacy ??= createLegacyPolicy(getPolicy(AI_POLICY_VERSION))) : getPolicy(version);

const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => [key, item[key]])) : item);
const plannedCommands = new WeakMap();

function teacherAction(policy,game,playerId) {
  const command=policy.chooseAiAction(game,playerId);
  if(allowsMagicArcherAiAction(game,playerId,command))return command;
  // Historical teachers retain their ranking inside the current AI curriculum.
  // The model itself never falls back to a teacher when its choices are masked.
  const alternative=policy.rankAiActions(game,playerId)
    .find(entry=>allowsMagicArcherAiAction(game,playerId,entry.action))?.action;
  if(alternative)return alternative;
  if(game.canActivate(playerId))return {type:'activate'};
  throw new Error('No teacher action satisfies the magic archer curriculum');
}

// Explicit teacher/opponent mode only. Never used as a fallback for a model.
export function teacherIndex(input, version) {
  const {game,playerId,request,candidates}=input;
  if (request.required && candidates.length === 1) return 0;
  if(input.teacherIndex) {
    const root=input.rootRequest, policy=teachingPolicy(version);
    let commands = input.decisionScope ? plannedCommands.get(input.decisionScope) : null;
    if (input.decisionScope && !commands) {
      commands = new Map();
      plannedCommands.set(input.decisionScope, commands);
    }
    const cached = commands?.get(version);
    let command = cached?.command;
    if (!cached || cached.game !== game || cached.playerId !== playerId || cached.root !== root) {
      if(root.type==='action') command=teacherAction(policy,game,playerId);
      else if(root.type==='overflow') command=policy.chooseAiDiscard(game,playerId,game.player(playerId).hand.length-game.player(playerId).handLimit);
      else command=policy.chooseAiRuleDecision(root,game);
      commands?.set(version, { game, playerId, root, command });
    }
    const index=input.teacherIndex(command);
    if(!Number.isInteger(index)||index<0||index>=candidates.length) throw new Error(`Teacher ${version} cannot complete ${request.type}/${request.stage}`);
    return index;
  }
  if (request.required && candidates.length === 1) return 0;
  if (request.skillId === 'activationRoute') return candidates.indexOf(request.defaultValue);
  if (request.blockedReason) return candidates.indexOf(false);
  const policy = teachingPolicy(version);
  let value;
  if (request.type === 'action') {
    value = teacherAction(policy, game, playerId);
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
      // Response indices can also refer to a hero's playable covered cards.
      const card = request.valid.find(entry => entry.index === choice.index)?.card;
      return canonical({ index: choice.index, targetId: card?.name === 'holyLight' ? null : choice.targetId ?? null });
    }
    if (['cardChoice', 'overflow'].includes(request.type) && Array.isArray(choice)) return canonical([...choice].sort((a,b) => a-b));
    return canonical(choice ?? null);
  };
  const index = candidates.findIndex(candidate => key(candidate) === key(value));
  if (index < 0) throw new Error(`Teacher ${version} returned unrepresented ${request.type}: ${canonical(value)}`);
  return index;
}
