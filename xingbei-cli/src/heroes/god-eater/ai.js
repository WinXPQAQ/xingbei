import { cheapCards, damageTarget } from "../shared/ai/decisions.js";
const blade = (c) => ["demonBlade", "alienBlade"].includes(c.name);
export const godEaterAi = {
  id: "godEater",
  sharedDecisionSkills: ["bladeElement"],
  cardBonus: ({ card }) => (blade(card) ? 14 : card.type === "attack" ? 4 : 0),
  refineBonus: ({ player, gem, crystal }) =>
    !player.energy.gem && gem ? 7 : !player.energy.crystal && crystal ? 4 : 0,
  attackHitBonus: ({ card, targetId, state }, api) =>
    blade(card)
      ? 4 +
        Math.max(
          0,
          state.players[targetId].count + 1 - state.players[targetId].limit,
        ) *
          5
      : 0,
  scoreSkill({ skillId, game, next, id, player }, api) {
    if (skillId !== "ragnarok") return null;
    const blades = [...game.cards.values()].filter(
      (c) =>
        blade(c) &&
        [player.heroState.demonBladeId, player.heroState.alienBladeId].includes(
          c.id,
        ) &&
        c.location.zone !== "outside",
    );
    api.hurt(next, id, 2, "spell");
    for (const c of blades)
      if (Number.isInteger(c.location.playerId)) {
        const holder = next.players[c.location.playerId];
        holder.count = Math.max(0, holder.count - 1);
        api.hurt(next, holder.id, 3, "spell");
      }
    if (blades.length === 2) {
      const foe = next.players
        .filter((p) => p.team !== player.team)
        .sort((a, b) => b.count - b.limit - (a.count - a.limit))[0];
      api.hurt(next, foe.id, 2, "spell");
    }
    return blades.length ? 2 : -10;
  },
  decisions: {
    bladeControl: ({ player, request }) =>
      player.count < player.limit
        ? (request.choices.find((c) => c.value !== null)?.value ?? null)
        : null,
    engraving: () => true,
    devour: (a, api) =>
      a.state.players[a.context.targetId]?.healing > 0
        ? cheapCards(a, api)
        : null,
    annihilate: (a, api) =>
      a.state.players.some(
        (p) =>
          p.team !== a.player.team &&
          p.id !== a.context.targetId &&
          p.healing > 0,
      )
        ? cheapCards(a, api)
        : null,
    annihilateTarget: ({ request, state }) =>
      [...request.choices].sort(
        (a, b) =>
          state.players[b.value].healing - state.players[a.value].healing,
      )[0].value,
    resonance: (a, api) =>
      a.player.energy.crystal + a.player.energy.gem > 0 &&
      a.player.count >= a.player.limit - 1
        ? cheapCards(a, api)
        : null,
    resonanceBlades: ({ request, player }) => {
      if (player.count >= player.limit) return null;
      return player.count + 2 <= player.limit &&
        request.choices.some((c) => c.value === "both")
        ? "both"
        : (request.choices.find((c) => c.value && c.value !== "both")?.value ??
            null);
    },
    resonanceTarget: damageTarget,
    ragnarokTarget: (a, api) => damageTarget(a, api, 2),
    bladeElement: ({ request, state, source }) => {
      // Thunder threatens overflow; wind makes useful follow-ups. Only public state.
      const target = state.players[request.context?.targetId];
      const preferred =
        target && target.count >= target.limit ? "thunder" : "wind";
      const safe = request.choices.filter(
        (c) => !source.getStatus(`${c.value}Seal`).length,
      );
      return (
        (safe.length ? safe : request.choices).find(
          (c) => c.value === preferred,
        )?.value ??
        safe[0]?.value ??
        request.defaultValue
      );
    },
  },
};
