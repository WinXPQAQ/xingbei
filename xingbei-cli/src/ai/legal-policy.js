import { legalActions } from '../legal-actions.js';
import { RuleError } from '../errors.js';
const cache = new WeakMap();
const key = a => JSON.stringify([a.type,a.index,a.targetId,a.skillId,a.mode,a.cardIds,a.targetIds,a.gemCount,a.stones?.gem,a.stones?.crystal]);
// Frozen scores retain their ordering. Previously omitted legal choices remain
// available when a historical heuristic rejected every action as undesirable.
export function legalPolicy(policy) {
  if (cache.has(policy)) return cache.get(policy);
  const adapted = { ...policy,
    rankAiActions(game, id) {
      // A current policy may exclude useless candidates even during refresh or
      // fallback. Historical policies omit this hook and keep their full set.
      const legal = legalActions(game,id)
        .filter(action => policy.acceptsAction?.(game,id,action) ?? true);
      const keys = new Set(legal.map(key));
      // Frozen refresh evaluators treated exchange as a completed action. Never
      // execute that obsolete model: exchange now, then ask the policy again.
      if (legal.some(a => a.type === 'refresh')) return legal.map(action => ({ action, score: 0,
        reason: 'unscored-inability-procedure', explanation: { completesAction: action.type !== 'refresh' } }));
      const ranked = policy.rankAiActions(game,id).filter(e => keys.has(key(e.action)));
      return ranked.length ? ranked : legal.map(action => ({action,score:-Infinity,reason:'required-legal-action'}));
    },
    chooseAiAction(game,id) {
      const first = adapted.rankAiActions(game,id)[0];
      if (!first) throw new RuleError('没有合法行动；必须核查规则状态，不能跳过普通行动');
      return first.action;
    },
  };
  cache.set(policy, adapted);
  return adapted;
}
