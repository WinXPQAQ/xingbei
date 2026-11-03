import { cheapCards } from "../shared/ai/decisions.js";
export const holidayMageAi = {
  id: "holidayMage",
  acceptsRefine: (a) => !a.stones.crystal,
  cardBonus: ({ card, elements }) =>
    card.type === "spell"
      ? 12
      : elements.some((e) => ["earth", "fire"].includes(e))
        ? 5
        : 0,
  refineBonus: ({ player, gem }) => (!player.energy.gem && gem ? 8 : 0),
  scoreSkill({ next, id, player, action, skillId, targetId }, api) {
    if (skillId === "magicBurst") {
      api.stones(next, player.team, "gem", 1);
      api.hurt(next, targetId, 2);
      return 5;
    }
    if (skillId === "destructionStorm") {
      for (const t of action.targetIds) api.hurt(next, t, 2);
      return 1;
    }
    if (skillId === "magicFusion") {
      api.hurt(next, targetId, 2);
      return -3;
    }
    return null;
  },
  sharedDecisionSkills: ["holidayBurstResponse"],
  decisions: {
    holidayBurstResponse: (a, api) =>
      a.player.count >= a.player.limit - 1 ? cheapCards(a, api) : null,
    manaShield: ({ request, player }) =>
      Math.min(
        Math.max(
          0,
          player.count +
            (request.context?.amount ?? 2) -
            player.limit -
            player.healing,
        ),
        request.choices.at(-1).value,
      ),
    manaShieldCards: cheapCards,
  },
};
