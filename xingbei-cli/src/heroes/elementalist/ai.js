import { createDeck } from "../../cards.js";
import { gemPreparation } from "../shared/ai/wave-two/energy.js";
import { elementalSkills } from "./ai-enhancement.js";
import { planElementalActions, elementalActionKey, chooseElementalEnhancement } from "./ai-plan.js";

const printed = createDeck();
const fusionRate = printed.filter((card) => card.name === "magicBullet" || card.elements.some((element) => element === "fire" || element === "earth")).length / printed.length;
export const canRelayMagic = (player, card) => player.skillIds.includes("magicFusion") && card.elements.some((element) => element === "earth" || element === "fire");
export const magicRelayRate = (player, ordinaryRate) => player.skillIds.includes("magicFusion") ? fusionRate : ordinaryRate;
export function magicElementValue(g, id, afterSpend, ongoing) {
  if (!afterSpend.players[id].skillIds.includes("elementAbsorption") || (g.player(id).hero.state?.elements ?? 0) >= 3) return 0;
  return ongoing.reduce((n, branch) => n + (branch.elementGain ? branch.probability * 1.5 : 0), 0);
}
function refinementAdjustment(g, id, action) {
  const player = g.player(id), team = g.stoneCounts(player.team), { gem, crystal } = action.stones;
  const single = team.gem === 1 && team.crystal <= 1 && gem === 1;
  if (gem + crystal < 2 && !single) return -1e6;
  return gemPreparation(g, id, action, { allowSingle: single, crystalBonus: true });
}
export const elementalistAi = {
  retentionBonus: (g, id, card) => Object.keys(elementalSkills).some((skill) => card.hasUniqueSkill(skill)) ? 5 : 0,
  planActions: planElementalActions,
  actionKey: elementalActionKey,
  hasSpellContinuation: (player) => player.hand.some((card) => card.uniqueSkills.some((skill) => player.skillIds.includes(skill) && Object.hasOwn(elementalSkills, skill))),
  chooseRuleDecision(request, g) {
    const selected = chooseElementalEnhancement(g, request.playerId ?? request.player?.id, request);
    if (selected !== undefined) return selected;
    if (request.type === "skillChoice" && request.skillId === "elementAbsorption") return true;
  },
  acceptsCrystalRefinement: (player, action) => player.energy.crystal + action.stones.crystal <= 1,
  refinementAdjustment,
};
