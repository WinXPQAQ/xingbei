import { holidayMageAi } from "../holiday-mage/ai.js";
import { cheapCards } from "../shared/ai/decisions.js";
export const gluttonousGirlAi = {
  ...holidayMageAi,
  id: "gluttonousGirl",
  cardBonus: ({ card, elements }) =>
    card.name === "magicBullet"
      ? 28
      : card.type === "spell"
        ? 14
        : elements.some((e) => ["water", "fire"].includes(e))
          ? 6
          : 0,
  scoreSkill(a, api) {
    if (a.skillId === "deliciousFusion") {
      api.hurt(a.next, a.targetId, 2);
      return -2;
    }
    if (a.skillId === "magicBurst") {
      api.stones(a.next, a.player.team, "gem", 1);
      for (const id of a.action.targetIds) api.hurt(a.next, id, 2);
      api.discardEstimate(a.next, a.id, Math.min(2, a.player.count));
      return 2;
    }
    return holidayMageAi.scoreSkill(a, api);
  },
  decisions: {
    appetiteBlackHole: (a, api) =>
      a.context.actual + a.state.players[a.context.targetId].count >
      a.state.players[a.context.targetId].limit
        ? cheapCards(a, api)
        : null,
    threeSecondRule: ({ player, request }) =>
      request.type === "skillChoice" ? player.count < player.limit : undefined,
  },
};
