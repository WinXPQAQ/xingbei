import {
  cheapCards,
  cheapCovered,
  damageTarget,
  discardTarget,
} from "../shared/ai/decisions.js";
export const curseTalismanAi = {
  id: "curseTalisman",
  energyPreference: "crystal",
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
    curseChant: (a, api) => {
      if (a.player.count <= 2) return null;
      const cost = (i) => api.cardScore(a.game, a.id, a.source.hand[i]) -
        (a.source.hand[i].getTraits({ playerId: a.id }).elements.includes("earth") ? 12 : 0) +
        ((a.game.turn.state?.reservedCardIds ?? []).includes(a.source.hand[i].id) ? 1000 : 0);
      const index = [...(a.request.valid ?? [])].sort((x, y) => cost(x) - cost(y))[0];
      return index == null ? null : [index];
    },
    ghostApparition: (a, api) => {
      const earth = a.request.choices.filter((c) => a.game.cards.get(c.value)?.getTraits({ playerId: a.id }).elements.includes("earth"));
      return cheapCovered({ ...a, request: { ...a.request, choices: earth.length ? earth : a.request.choices } }, api);
    },
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
