import { cheapCards } from "../shared/ai/decisions.js";
export const slothGirlAi = {
  id: "slothGirl",
  cardBonus: ({ same, card }) => (same ? 8 : card.type === "spell" ? 5 : 0),
  scoreSkill({ next, id, player, skillId, targetId }, api) {
    if (skillId === "wantMagicBullet") {
      api.hurt(next, targetId, 2);
      return -2;
    }
    if (skillId === "leaveMeAlone") {
      api.discardEstimate(next, id, 1);
      api.stones(next, player.team, "crystal", 1);
      const t = next.players
        .filter((t) => t.team !== player.team)
        .sort((a, b) => b.count - a.count)[0];
      api.draw(next, t.id, 2);
      return 3;
    }
    return null;
  },
  sharedDecisionSkills: ["slothResponse", "slothDrawTarget"],
  decisions: {
    slothDrawTarget: ({ request, state }) =>
      [...request.choices].sort(
        (a, b) =>
          state.players[b.value].count -
          state.players[b.value].limit -
          (state.players[a.value].count - state.players[a.value].limit),
      )[0].value,
    slothResponse: (a, api) =>
      a.player.count >= a.player.limit ? cheapCards(a, api) : null,
    letMeRestOffer: ({ player, state }) =>
      player.energy.gem > 0 &&
      state.players.some(
        (p) =>
          p.team === player.team &&
          p.id !== player.id &&
          p.healing < p.healingLimit,
      ),
    slothStone: ({ request }) =>
      request.choices.find((c) => c.value === "crystal")?.value ??
      request.defaultValue,
    slothMagicResponse: (a, api) =>
      a.player.count + (a.context.amount ?? 2) - a.player.healing >
      a.player.limit
        ? cheapCards(a, api)
        : null,
  },
};
