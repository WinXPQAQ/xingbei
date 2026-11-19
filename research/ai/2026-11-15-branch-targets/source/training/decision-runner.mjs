import { forcedMagicArcherRefine, allowsMagicArcherAiAction, forcedMagicArcherAiChoice } from '../src/heroes/magic-archer/ai.js';
import { buildDecisionSpace, DECISION_MODE_V3 } from './decision-space.mjs';
import { actionCandidates, decisionCandidates } from './candidates.mjs';

function ordinaryChoice(request, candidate) {
  if (request.type === 'action')
    return !['heroSkill', 'skill', 'refine'].includes(candidate?.direction ?? candidate?.type);
  // A skill can cause a normal heal, response or overflow without owning that
  // new decision. Inspect the request itself, not the surrounding context.
  if (['healing', 'response', 'overflow', 'weakness'].includes(request.type)) return true;
  if (request.type === 'energyChoice') return false;
  return request.skillId == null;
}

// A scope lasts for one engine request. Only the final command leaves this
// function; partial choices never move cards or advance the engine.
export async function resolveDecision(game, playerId, request, select, {
  hierarchical = true,
  mode = 'hierarchical-v1',
  measureCandidates = operation => operation(),
} = {}) {
  const decisionScope = {};
  const v3 = mode === DECISION_MODE_V3;
  async function choose(current, candidates, extra = {}) {
    if (!v3 && request.type === 'action') {
      const indices=candidates.flatMap((candidate,index)=>allowsMagicArcherAiAction(game,playerId,candidate)?[index]:[]);
      if(indices.length!==candidates.length) {
        const originalTeacher=extra.teacherIndex;
        candidates=indices.map(index=>candidates[index]);
        extra={...extra,summaries:extra.summaries?indices.map(index=>extra.summaries[index]):undefined,
          teacherIndex:originalTeacher?command=>indices.indexOf(originalTeacher(command)):undefined};
        if(candidates.length===1)current={...current,required:true};
      }
    }
    if (!candidates.length) throw new Error(`Empty candidates: ${current.type}`);
    const routing = v3 ? {
      v3: { hero: game.player(playerId).hero.id, ordinary: candidates.map(value => ordinaryChoice(current, value)) },
    } : {};
    const index = await select({ game, playerId, request: current, candidates,
      rootRequest: request, decisionScope, ...extra, ...routing });
    if (!Number.isInteger(index) || index < 0 || index >= candidates.length) {
      throw new Error(`Invalid candidate index ${index}`);
    }
    return candidates[index];
  }

  // Explicit AI curriculum constraint, not a rule-level loss of legal actions.
  if (!v3) {
    const forced = request.type === 'action' ? forcedMagicArcherRefine(game, playerId) : null;
    if (forced) return choose({...request, required:true}, [forced]);
    const forcedChoice=forcedMagicArcherAiChoice(game,playerId,request);
    if(forcedChoice!==undefined)return choose({...request,required:true},[forcedChoice]);
  }
  let node = hierarchical ? measureCandidates(() => buildDecisionSpace(game, playerId, request, { mode })) : null;
  if (node) {
    while (!node.done) {
      const value = await choose(node.request, node.candidates,
        { summaries: node.summaries, teacherIndex: node.teacherIndex });
      node = measureCandidates(() => node.next(value));
    }
    return node.value;
  }
  const candidates = measureCandidates(() => request.type === 'action'
    ? actionCandidates(game, playerId) : decisionCandidates(game, request));
  return choose(request, candidates);
}
