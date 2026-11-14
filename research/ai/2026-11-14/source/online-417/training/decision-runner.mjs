import { buildDecisionSpace } from './decision-space.mjs';
import { actionCandidates, decisionCandidates } from './candidates.mjs';

// A scope lasts for one engine request. Only the final command leaves this
// function; partial choices never move cards or advance the engine.
export async function resolveDecision(game, playerId, request, select, {
  hierarchical = true,
  measureCandidates = operation => operation(),
} = {}) {
  const decisionScope = {};
  async function choose(current, candidates, extra = {}) {
    if (!candidates.length) throw new Error(`Empty candidates: ${current.type}`);
    const index = await select({ game, playerId, request: current, candidates,
      rootRequest: request, decisionScope, ...extra });
    if (!Number.isInteger(index) || index < 0 || index >= candidates.length) {
      throw new Error(`Invalid candidate index ${index}`);
    }
    return candidates[index];
  }

  let node = hierarchical ? measureCandidates(() => buildDecisionSpace(game, playerId, request)) : null;
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
