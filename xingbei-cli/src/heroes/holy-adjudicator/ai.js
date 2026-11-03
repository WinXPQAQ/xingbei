import { cheapCards, damageTarget } from "../shared/ai/decisions.js";
export const holyAdjudicatorAi = {
  id: "holyAdjudicator",
  cardBonus: ({ elements, player }) =>
    player.covered.some((c) => c.elements.some((e) => elements.includes(e)))
      ? 12
      : 0,
  resourceValue: (p) => p.coveredCount * 3 + (p.heroState.sins ?? 0) * 2,
  scoreSkill({ player, skillId }, api) {
    return skillId === "sinArrives"
      ? Math.min(player.count, player.heroState.sins) * 5 - 3
      : null;
  },
  decisions: {
    goodEvilReckoning: cheapCards,
    scaleSide: ({ request, source }) =>
      [...request.choices].sort(
        (a, b) =>
          source.covered.filter((c) => c.location.pile === a.value).length -
          source.covered.filter((c) => c.location.pile === b.value).length,
      )[0].value,
    scaleDraw: ({ request, game, id }, api) =>
      [...request.choices].sort(
        (a, b) =>
          api.cardScore(game, id, game.cards.get(b.value)) -
          api.cardScore(game, id, game.cards.get(a.value)),
      )[0].value,
    divineJudgment: () => true,
    divineJudgmentTarget: (a, api) => damageTarget(a, api, 2),
    leftScaleTarget: damageTarget,
    heavenSin: ({ player, request }) =>
      player.count >= 4 && request.reservedCardIds?.length > 0,
    heavenSinCards: cheapCards,
    leftScaleCard: ({ request }) => request.choices[0].value,
    sinArrivesCard: cheapCards,
  },
};
