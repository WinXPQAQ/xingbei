import { cheapCards, usefulExtra } from "../shared/ai/decisions.js";
export const swordChildAi = {
  id: "swordChild",
  cardBonus: ({ card, elements, same }) =>
    card.uniqueSkills.some((s) => ["galeArt", "stormArt"].includes(s))
      ? 25
      : card.type === "attack"
        ? 8
        : 0,
  attackHitBonus: () => 7,
  decisions: {
    windSword: ({ source, context }) =>
      context.card?.uniqueSkills.includes("stormArt") ||
      source.hand.some((c) => c.type === "attack"),
    windSwordStone: ({ request }) =>
      request.choices.find((c) => c.value === "crystal")?.value ??
      request.defaultValue,
    swordOath: () => true,
    oathCard: ({ request, player, game, id }, api) =>
      player.count >= player.limit
        ? null
        : ([...request.choices]
            .filter((c) => c.value != null)
            .sort(
              (a, b) =>
                api.cardScore(game, id, game.cards.get(b.value)) -
                api.cardScore(game, id, game.cards.get(a.value)),
            )[0]?.value ?? null),
    swordAfterimage: (a, api) =>
      a.request.type === "skillChoice" ? usefulExtra(a, api) : undefined,
    afterimageTarget: ({ request, state }) =>
      [...request.choices].sort(
        (a, b) => state.players[b.value].count - state.players[a.value].count,
      )[0].value,
    swordSeverance: usefulExtra,
    swordSeveranceCost: cheapCards,
  },
};
