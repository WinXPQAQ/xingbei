import { bestAttack } from "../shared/ai/base/planner.js";

export function magicFollowUpValue(g, id, afterSpend, ongoing) {
  if (!afterSpend.players[id].skillIds.includes("spellExcitation")) return 0;
  // The relay is uncertain: a follow-up cannot inherit a certain-win bonus.
  return ongoing.reduce((n, branch) => n + branch.probability * Math.max(0,
    bestAttack({ ...branch.state, uncertain: true }, id, { depth: 1, sequence: false }).score,
  ), 0);
}
