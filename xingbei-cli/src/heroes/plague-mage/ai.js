import { damage, heal } from "../shared/ai/base/model.js";
import { healingValue } from "../shared/ai/wave-two/value.js";
import { gemPreparation } from "../shared/ai/wave-two/energy.js";

export function damageHealing(player, amount, type) {
  return type === "attack" ? 0 : Math.min(player.healing, amount);
}
function scoreSkill({ game: g, id, action, state, before, costs, spec }) {
  const skill = action.skillId;
  if (skill === "plague" || skill === "toxicNova") {
    for (const target of g.players) if (target.id !== id) damage(state, target.id, skill === "plague" ? 1 : 2, "spell");
    if (skill === "toxicNova" || Object.keys(state.teams).some((team) => state.teams[team].morale < before.teams[team].morale)) heal(state, id, 1);
  }
  if (skill === "deathTouch") {
    state.players[id].healing -= spec.healingCost;
    damage(state, action.targetIds[0], spec.healingCost + costs.length - 3, "spell");
  } else heal(state, id, 1);
  return {};
}
export function magicHealingValue(g, id, afterSpend, ongoing) {
  if (!afterSpend.players[id].skillIds.includes("immortality")) return 0;
  return ongoing.reduce((n, branch) => n + branch.probability * Math.min(1,
    Math.max(0, branch.state.players[id].healingLimit - branch.state.players[id].healing),
  ) * 2.5, 0);
}
export const plagueMageAi = {
  scoreSkill,
  retentionBonus: (g, id, card, { elements, same }) => elements.includes("earth") || card.type === "spell" ? same ? 1.5 : 3 : 0,
  playBonus: (g, id, card) => card.type === "spell" ? healingValue(g, id, id) + 1 : 0,
  chooseRuleDecision: (request) => request.type === "skillChoice" && request.skillId === "immortality" ? true : undefined,
  acceptsCrystalRefinement: () => false,
  refinementAdjustment: gemPreparation,
};
