import { cheapCards } from "../shared/ai/decisions.js";
export const mischiefGirlAi = {
  id: "mischiefGirl",
  energyPreference: "crystal",
  cardBonus: ({ card }) =>
    card.hasUniqueSkill("angelWall")
      ? 24
      : card.name === "holyShield"
        ? 18
        : card.type === "spell"
          ? 8
          : 0,
  scoreSkill({ next, id, player, skillId, targetId }, api) {
    if (skillId === "angelWall") {
      next.players[targetId].effects.push({ name: "holyShield" });
      return next.players[targetId].team === player.team ? 5 : -20;
    }
    if (skillId === "rebelliousWall") {
      const t = next.players[targetId];
      return t.team === player.team &&
        t.effects.some((e) => e.name !== "holyShield")
        ? 10
        : -4;
    }
    if (skillId === "surprise")
      return player.count >= player.limit - 1 ? 5 : -8;
    return null;
  },
  sharedDecisionSkills: ["trickTreatCost"],
  decisions: {
    foreshadowCount: ({ request }) => request.choices.at(-1).value,
    trickyTarget: ({ request, state, player }) =>
      request.choices.find((c) => state.players[c.value].team !== player.team)
        ?.value ?? request.defaultValue,
    trickyShot: () => true,
    trickyPeek: ({ request, game, state, id }, api) =>
      [...request.choices].filter((c) => game.cards.has(c.value))
        .sort((a, b) => api.damageGain(state, id, game.cards.get(b.value).location.playerId, 2) -
          api.damageGain(state, id, game.cards.get(a.value).location.playerId, 2))[0]?.value ?? request.defaultValue,
    trickyReveal: ({ request }) =>
      request.choices.find((c) => c.value != null)?.value ?? null,
    trickyCost: cheapCards,
    trickTreatCost: (a, api) =>
      a.player.count >= a.player.limit - 1 ? cheapCards(a, api) : null,
    trickTreatReward: ({ player }) => (player.count > 3 ? "turn" : "crystal"),
    surpriseCard: (a, api) => (a.player.count > 3 ? cheapCards(a, api) : null),
    rebelliousEffect: ({ request, game, player }) => {
      const priority = (value) => {
        const card = game.cards.get(value), effect = card?.attachment?.effectId;
        const relief = effect === "weakness" ? 3 : game.effects.get(effect)?.isSeal ? 2 : effect === "poison" ? 1 : 0;
        return relief * (game.player(card.location.playerId).team === player.team ? 1 : -1);
      };
      return [...request.choices].sort((a, b) => priority(b.value) - priority(a.value))[0]?.value ?? request.defaultValue;
    },
  },
};
