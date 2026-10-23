// Water retention, stealth preparation and backlash belong to the assassin.
export const assassinAi = {
  id: "assassin",
  cardBonus: ({ elements, same }) => elements.includes("water") ? (same ? 8 : 24) : 0,
  resourceValue: (p) => p.energy.gem * 5 + p.energy.crystal * (p.energy.gem || p.heroState.form ? 2 : 0.5) + (p.heroState.form ? 3 : 0),
  refineBonus: ({ player, gem }) => gem && !player.energy.gem ? 8 : 0,
  attackDamage: ({ player, active }, { energy }) => active && player.heroState.form ? energy(player) : 0,
  uncounterable: ({ player, active }) => active && !!player.heroState.form,
  blocksActiveAttack: (player) => !!player.heroState.form,
  afterAttackDamage({ state, actorId, actual }, { terminal, draw }) {
    if (actual > 0 && !terminal(state)) draw(state, actorId, 1);
  },
  preparations({ state, id, player, card, options }, { copy, payEnergy, lowerHandLimit }) {
    if (card?.type !== "attack" || player.heroState.form || player.energy.gem <= 0) return options;
    const prepared = copy(state); payEnergy(prepared, id, 1, "gem");
    prepared.players[id].heroState.form = "潜行";
    lowerHandLimit(prepared, id, player.limit - 1);
    if (prepared.players[id].hand.some((c) => c.id === card.id)) options.push({ state: prepared, activated: "stealth" });
    return options;
  },
  decisions: {
    stealth({ game, id, state, request, player }, { activationUseful }) {
      if (request.type === "skillChoice") return activationUseful(game, id, state, request, "stealth");
      if (request.type === "numberChoice") return player.count + 1 <= player.limit - 1 && player.count <= 2 ? 1 : 0;
    },
    waterShadow({ game, id, request, context, player, source }, { elements, cardScore, lowCards }) {
      const reserved = new Set(game.turn.state?.reservedCardIds ?? []);
      if (request.type === "numberChoice") {
        const useful = source.hand.filter((c) => elements(game, id, c).includes("water") && !reserved.has(c.id) && cardScore(game, id, c) < 130).length;
        const needed = Math.max(0, player.count + (context.drawCount ?? context.count ?? 0) - player.limit);
        return Math.min(needed, useful, Math.max(...request.choices.map((c) => Number(c.value))));
      }
      if (request.type === "cardChoice") {
        const valid = request.valid ?? source.hand.map((_, i) => i);
        const available = valid.filter((i) => !reserved.has(source.hand[i].id));
        if (request.optional && (player.count + (context.drawCount ?? 0) <= player.limit || !available.some((i) => cardScore(game, id, source.hand[i]) < 130))) return null;
        return lowCards(game, id, available.length >= request.count ? available : valid).slice(0, request.count);
      }
    },
  },
};
