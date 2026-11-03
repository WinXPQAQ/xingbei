import { cheapCards } from "../shared/ai/decisions.js";
export const magicArcherEXAi = {
  id: "magicArcherEX",
  cardBonus: ({ card, elements, same }) =>
    card.uniqueSkills?.some((s) => ["flashTrap", "precisionShot"].includes(s))
      ? 30
      : elements.includes("wind")
        ? same
          ? 5
          : 18
        : card.type === "spell"
          ? 12
          : 0,
  uncounterable: ({ card }) => card.elements.includes("wind"),
  attackMissBonus: ({ player, active }) =>
    active && player.hand.some((c) => c.type === "spell") ? 4 : 0,
  scoreSkill({ next, skillId, targetId }, api) {
    if (skillId === "flashTrap") {
      api.hurt(next, targetId, 2);
      return 1;
    }
    if (skillId === "snipe") {
      api.draw(next, targetId, Math.max(0, 5 - next.players[targetId].count));
      return 6;
    }
    return null;
  },
  decisions: {
    precisionShot: ({ context, state }) =>
      !state.players[context.targetId].effects.some(
        (e) => e.name === "holyShield",
      )
        ? state.players[context.targetId].count >= 3
        : true,
    piercingShot: (a, api) =>
      api.damageGain(a.state, a.id, a.context.targetId, 2) > 4
        ? cheapCards(a, api)
        : null,
  },
};
