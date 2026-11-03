import {
  cheapCards,
  cheapCovered,
  damageTarget,
  discardTarget,
} from "../shared/ai/decisions.js";
export const curseTalismanAi = {
  id: "curseTalisman",
  cardBonus: ({ elements, same }) =>
    elements.some((e) => ["fire", "water"].includes(e))
      ? same
        ? 4
        : 16
      : elements.includes("earth")
        ? 7
        : 0,
  resourceValue: (p) => p.coveredCount * 3,
  scoreSkill({ state, id, player, skillId }, api) {
    if (!["fireTalisman", "iceTalisman"].includes(skillId)) return null;
    const gain =
      skillId === "fireTalisman"
        ? Math.max(
            ...state.players.map((t) => api.damageGain(state, id, t.id, 1)),
          )
        : 2;
    return gain + (player.coveredCount < 2 ? 4 : 0);
  },
  decisions: {
    fireTalisman: (a, api) =>
      a.request.type === "playerChoice"
        ? damageTarget(a, api, a.context.amount ?? 1)
        : cheapCards(a, api),
    iceTalisman: (a, api) =>
      a.request.type === "playerChoice"
        ? discardTarget(a, api, a.context.amount ?? 1)
        : cheapCards(a, api),
    curseChant: (a, api) => (a.player.count > 2 ? cheapCards(a, api) : null),
    ghostApparition: cheapCovered,
    earthCurse: () => true,
    ghostTalisman: ({ state, player }) =>
      state.players.some((p) => p.team !== player.team && p.count >= p.limit)
        ? "fireTalisman"
        : "iceTalisman",
    curseReshape: ({ state, player }) =>
      state.players.filter(
        (p) => p.team !== player.team && p.count >= p.limit - 1,
      ).length > 1,
    iceHealing: ({ request, state, player }) =>
      [...request.choices].sort(
        (a, b) =>
          (state.players[b.value].team !== player.team ? 10 : 0) +
          state.players[b.value].healing -
          ((state.players[a.value].team !== player.team ? 10 : 0) +
            state.players[a.value].healing),
      )[0].value,
  },
  sharedDecisionSkills: ["fireTalisman", "iceTalisman"],
};
