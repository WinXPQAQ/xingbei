// Water retention, stealth preparation and backlash belong to the assassin.
function stealthOptions(state, id, api, pay = false) {
  return [0, 1].map((drawCount) => {
    const next = api.copy(state);
    if (pay) api.payEnergy(next, id, 1, "gem");
    // Optional draw happens before the form and lower limit. Unknown cards stay
    // unknown; a future attack is not assumed merely because a card was drawn.
    if (drawCount) api.draw(next, id, drawCount);
    if (!api.terminal(next)) {
      next.players[id].heroState.form = "潜行";
      api.lowerHandLimit(next, id, state.players[id].limit - 1);
    }
    return { state: next, drawCount, value: api.evaluate(next) };
  }).sort((a, b) => b.value - a.value || a.drawCount - b.drawCount);
}

export const assassinAi = {
  id: "assassin",
  energyPreference: "gem",
  usefulCrystals: 1,
  cardBonus({ card, elements, same, retained }) {
    const attacks = retained.filter((c) => c.type === "attack").length;
    const spells = retained.filter((c) => c.type === "spell" && c.name !== "holyLight").length;
    const water = elements.includes("water") ? (same ? 6 : 20) : 0;
    return water + (card.type === "attack" ? (attacks < 2 ? 22 - attacks * 8 : 4) : -Math.max(0, spells - 1) * 9);
  },
  resourceValue: (p) => p.energy.gem * 5 + Math.min(1, p.energy.crystal) * (p.energy.gem || p.heroState.form ? 2 : 0.5) + (p.heroState.form ? 4 : 0),
  refineBonus({ player, gem, crystal }) {
    const firstCrystal = Math.min(crystal, Math.max(0, 1 - player.energy.crystal));
    return (gem && !player.energy.gem ? 12 : 0) + gem * 3 + firstCrystal - (crystal - firstCrystal) * 10 - (!gem && !player.energy.gem ? 8 : 0);
  },
  actionBonus({ player, action }) {
    if (!["purchase", "synthesize"].includes(action.type)) return 0;
    // Buying/crafting remains legal and can still win. Its three-card draw is
    // already evaluated; this is the additional cost of a crowded spell hand.
    const spells = player.hand.filter((c) => c.type === "spell" && c.name !== "holyLight").length;
    const pressure = Math.max(0, player.count + 3 - player.limit);
    return -pressure * (2 + Math.min(3, spells));
  },
  attackDamage: ({ player, active }, { energy }) => active && player.heroState.form ? energy(player) : 0,
  uncounterable: ({ player, active }) => active && !!player.heroState.form,
  blocksActiveAttack: (player) => !!player.heroState.form,
  afterAttackDamage({ state, actorId, actual }, { terminal, draw }) {
    if (actual > 0 && !terminal(state)) draw(state, actorId, 1);
  },
  preparations({ state, id, player, card, options }, api) {
    if (card?.type !== "attack" || player.heroState.form || player.energy.gem <= 0) return options;
    for (const prepared of stealthOptions(state, id, api, true)) {
      if (prepared.state.players[id].hand.some((c) => c.id === card.id)) options.push({ ...prepared, activated: "stealth" });
    }
    return options;
  },
  decisions: {
    stealth({ game, id, state, request }, api) {
      if (request.type === "skillChoice") return api.activationUseful(game, id, state, request, "stealth");
      if (request.type === "numberChoice") return stealthOptions(state, id, api)[0].drawCount;
    },
    waterShadow({ game, id, request, context, player, source }, { elements, cardScore }) {
      const reserved = new Set(game.turn.state?.reservedCardIds ?? []);
      const attacks = source.hand.filter((c) => c.type === "attack").length;
      const cost = (card) => cardScore(game, id, card) + (card.type === "attack" && attacks <= 1 ? 65 : 0);
      if (request.type === "numberChoice") {
        const candidates = source.hand.filter((c) => elements(game, id, c).includes("water") && !reserved.has(c.id) && cost(c) < 130);
        const useful = candidates.filter((c) => c.type !== "attack").length +
          Math.min(candidates.filter((c) => c.type === "attack").length, Math.max(0, attacks - 1));
        const needed = Math.max(0, player.count + (context.drawCount ?? context.count ?? 0) - player.limit);
        const extraSpell = player.heroState.form && source.hand.some((c) => c.type === "spell" && !elements(game, id, c).includes("water") && !reserved.has(c.id) && cost(c) < 130) ? 1 : 0;
        return Math.min(Math.max(0, needed - extraSpell), useful, Math.max(...request.choices.map((c) => Number(c.value))));
      }
      if (request.type === "cardChoice") {
        const valid = request.valid ?? source.hand.map((_, i) => i);
        const available = valid.filter((i) => !reserved.has(source.hand[i].id));
        if (request.optional && (player.count + (context.drawCount ?? 0) <= player.limit || !available.some((i) => cost(source.hand[i]) < 130))) return null;
        return [...(available.length >= request.count ? available : valid)].sort((a, b) => cost(source.hand[a]) - cost(source.hand[b])).slice(0, request.count);
      }
    },
  },
};
