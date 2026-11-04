import {
  cheapCards,
  cheapCovered,
  damageTarget,
} from "../shared/ai/decisions.js";
export const starfallWitchAi = {
  id: "starfallWitch",
  cardBonus: ({ card, elements, retained }) =>
    elements.includes("earth")
      ? 20
      : !retained.some((c) => c.fates.some((f) => card.fates.includes(f)))
        ? 5
        : 0,
  resourceValue: (p) =>
    (p.coveredCount ?? 0) * 3 +
    ["starlight", "moonlight", "eclipse"].filter((k) => p.heroState[k]).length *
      2,
  refineBonus: ({ gem, player }) => (gem && !player.energy.gem ? 6 : 0),
  scoreSkill({ next, id, player, action, costs, skillId }, api) {
    if (skillId === "starRing") {
      for (const target of [id, ...action.targetIds]) {
        api.heal(next, target, 1);
        api.draw(next, target, 1);
      }
      return 7;
    }
    if (skillId === "creationRhythm") {
      const n = Math.min(
        player.count,
        1 +
          ["starlight", "moonlight", "eclipse"].filter(
            (k) => player.heroState[k],
          ).length,
      );
      api.discardEstimate(next, id, n);
      player.coveredCount = Math.min(6, (player.coveredCount ?? 0) + n);
      return 1;
    }
    return null;
  },
  decisions: {
    starEngraving: ({ player }) => player.coveredCount < 6,
    stellarRevelation: ({ player, request }) =>
      player.coveredCount >= 4 &&
      request.choices.some((c) => c.value === "invoke")
        ? "invoke"
        : player.count >= 4 && request.choices.some((c) => c.value === "add")
          ? "add"
          : request.choices.find(c => c.value === "skip")?.value ?? request.choices[0].value,
    revelationCard: cheapCards,
    revelationLaw: ({ request }) =>
      request.choices.find((c) => c.value === "starlight")?.value ??
      request.choices.find((c) => c.value === "moonlight")?.value ??
      request.choices[0].value,
    revelationDraw: ({ player, request }) => request.choices.find(c => c.value === Number(player.count < player.limit))?.value ?? request.choices[0].value,
    revelationRunes: cheapCovered,
    runeOverflow: cheapCovered,
    starlight: () => true,
    moonlight: () => true,
    eclipse: () => true,
    starlightGem: ({ request, state }) =>
      [...request.choices].sort(
        (a, b) =>
          state.players[a.value].energy.gem +
          state.players[a.value].energy.crystal -
          state.players[b.value].energy.gem -
          state.players[b.value].energy.crystal,
      )[0].value,
    moonlightTarget: (a, api) => damageTarget(a, api, 2),
    moonlightRecipients: () => 1,
    moonlightSplit: () => 1,
    removeLaw: ({ request }) =>
      request.choices.find((c) => c.value === "eclipse")?.value ??
      request.choices[0].value,
    goldenLaw: () => true,
    goldenSwap: () => false,
    creationDraw: () => 1,
    creationCount: ({ request }) =>
      Math.max(...request.choices.map((c) => c.value)),
    creationCards: cheapCards,
  },
};
