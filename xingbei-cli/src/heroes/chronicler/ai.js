import {
  cheapCards,
  cheapCovered,
  damageTarget,
} from "../shared/ai/decisions.js";
export const chroniclerAi = {
  id: "chronicler",
  cardBonus: ({ card }) =>
    card.name === "chronicle" ? 35 : card.type === "attack" ? 7 : 0,
  resourceValue: (p) =>
    (p.heroState.archives ?? 0) * 3 + (p.coveredCount ?? 0) * 2,
  refineBonus: ({ player, crystal }) =>
    crystal && !player.energy.crystal ? 6 : 0,
  scoreSkill({ player, skillId }) {
    if (skillId === "unityOfKnowledge") return 5;
    if (skillId === "myriadRuins") return player.coveredCount < 3 ? 10 : 0;
    return null;
  },
  decisions: {
    studyCard: cheapCovered,
    studyTarget: (a, api) =>
      a.context.card?.name === "holyShield"
        ? [...a.request.choices].sort(
            (x, y) =>
              Number(a.state.players[y.value].team === a.player.team) -
              Number(a.state.players[x.value].team === a.player.team),
          )[0].value
        : damageTarget(a, api, 2),
    ruinRebuttal: cheapCovered,
    ruinOverflow: cheapCovered,
    historicalCompilation: () => true,
    archiveExchangeHand: cheapCards,
    archiveExchangeRuins: ({ request, game, id }, api) =>
      request.choices
        .filter((c) => game.cards.has(c.value))
        .sort(
          (a, b) =>
            api.cardScore(game, id, game.cards.get(b.value)) -
            api.cardScore(game, id, game.cards.get(a.value)),
        )[0]?.value ?? null,
    myriadTargets: (a, api) => damageTarget(a, api, 2),
    pastPresent: ({ player, request }) =>
      player.energy.gem + player.energy.crystal >
        (request.reservedEnergy ?? 0) &&
      (player.heroState.archives > 0 || player.count >= 3),
  },
};
