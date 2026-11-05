function crystalConversionReady({ state, player }) {
  if (player.energy.gem || !player.heroState.form) return false;
  if (player.heroState.malice === 0) return true;
  // With one malice left, an available profitable empowered attack can finish
  // the form on the following ordinary turn. Do not reserve a crystal for a
  // distant, unprepared conversion.
  return player.heroState.malice === 1 && player.hand.some(c => c.type === "attack") &&
    state.players.some(p => p.team !== player.team && (p.healing > 0 || p.count + 3 >= p.limit));
}
export const defilerAi = {
  id: "defiler",
  energyPreference: "gem",
  usefulCrystals: context => crystalConversionReady(context) ? 1 : 0,
  cardBonus: ({ card }) => (card.type === "attack" ? 10 : 0),
  resourceValue: (p) =>
    (p.heroState.malice ?? 0) * 3 + (p.heroState.form ? 6 : 0),
  attackDamage: ({ player }) => (player.heroState.form ? 1 : 0),
  refineBonus: context => (context.gem && !context.player.energy.gem ? 5 : 0) +
    (context.crystal && !context.player.energy.crystal && crystalConversionReady(context) ? 4 : 0),
  actionBonus: ({ game, id, action }) =>
    action.type === "play" && game.player(id).hand[action.index]?.name === "poison" ? 2 : 0,
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
