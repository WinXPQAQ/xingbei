import { cheapCards, damageTarget } from "../shared/ai/decisions.js";
const unique = (c) =>
  c.uniqueSkills.some(
    (s) => s.endsWith("Seal") || ["powerBlessing", "speedBlessing"].includes(s),
  );
export const spiritTideAi = {
  id: "spiritTide",
  cardBonus: ({ card }) =>
    unique(card)
      ? 24
      : ["poison", "weakness", "holyShield"].includes(card.name)
        ? 15
        : 0,
  resourceValue: (p) => (p.heroState.surge ?? 0) * 3,
  scoreSkill({ skillId, next, id, player, targetId, costs }, api) {
    if (costs.length && unique(costs[0])) {
      next.players[targetId].effects.push({ name: skillId, source: id });
      api.discardEstimate(next, id, 1);
      return 8;
    }
    return null;
  },
  decisions: {
    spiritExorcismOffer: () => true,
    spiritExorcism: damageTarget,
    echoSpirit: () => true,
    ragingTide: (a, api) => damageTarget(a, api, 1),
    seaPriestess: cheapCards,
  },
};
