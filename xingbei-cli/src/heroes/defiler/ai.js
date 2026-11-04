export const defilerAi = {
  id: "defiler",
  cardBonus: ({ card }) => (card.type === "attack" ? 10 : 0),
  resourceValue: (p) =>
    (p.heroState.malice ?? 0) * 3 + (p.heroState.form ? 6 : 0),
  attackDamage: ({ player }) => (player.heroState.form ? 1 : 0),
  refineBonus: ({ gem, player }) => (gem && !player.energy.gem ? 5 : 0),
  decisions: {
    maliceSurge: ({ source }) => source.hand.some((c) => c.type === "attack"),
    ragingHeartTarget: ({ request, state, player }) =>
      [...request.choices].sort((a, b) => {
        const score = (id) =>
          (state.players[id].team === player.team ? -1 : 1) *
          state.players[id].healing;
        return score(b.value) - score(a.value);
      })[0].value,
    mindPollution: ({ context, state, player }) =>
      state.players[context.targetId].team !== player.team &&
      (state.players[context.targetId].healing > 0 ||
        state.players[context.targetId].count + context.amount >=
          state.players[context.targetId].limit),
    twistedLove: ({ player, request }) =>
      player.energy.gem > (request.reservedEnergy ?? 0) &&
      (!player.heroState.form || player.count >= player.limit),
    twistedForm: () => "raging",
    twistedCards: ({ player, request }) =>
      player.count <= player.limit - 3 || !request.choices.some(c => c.value === "discard") ? "draw" : "discard",
    twistedMalice: () => 2,
  },
};
