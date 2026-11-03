import { cheapCards } from "../shared/ai/decisions.js";
export const mischiefGirlAi = {
  id: "mischiefGirl",
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
    trickyPeek: ({ request, game, player }) =>
      request.choices.find(
        (c) =>
          game.player(game.cards.get(c.value).location.playerId).team !==
          player.team,
      )?.value ?? request.defaultValue,
    trickyReveal: ({ request }) =>
      request.choices.find((c) => c.value != null)?.value ?? null,
    trickyCost: cheapCards,
    trickTreatCost: (a, api) =>
      a.player.count >= a.player.limit - 1 ? cheapCards(a, api) : null,
    trickTreatReward: ({ player }) => (player.count > 3 ? "turn" : "crystal"),
    surpriseCard: (a, api) => (a.player.count > 3 ? cheapCards(a, api) : null),
    rebelliousEffect: ({ request }) => request.choices[0].value,
  },
};
