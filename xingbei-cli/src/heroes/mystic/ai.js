import {
  cheapCards,
  cheapCovered,
  damageTarget,
  discardTarget,
} from "../shared/ai/decisions.js";
export const mysticAi = {
  id: "mystic",
  cardBonus: ({ card }) =>
    card.fates.includes("Y") ? 12 : card.type === "spell" ? 7 : 0,
  resourceValue: (p) =>
    (p.heroState.sorcery ?? 0) * 4 + (p.coveredCount ?? 0) * 3,
  refineBonus: ({ player, crystal }) =>
    crystal && !player.energy.crystal ? 7 : 0,
  scoreSkill({ next, id, player, skillId, costs }, api) {
    if (skillId === "wordSpirit") {
      player.coveredCount = Math.min(3, player.coveredCount + costs.length);
      api.draw(next, id, 1);
      return 1;
    }
    if (skillId === "trueWord") {
      player.coveredCount--;
      return 10 + (player.energy.gem + player.energy.crystal ? 3 : 0);
    }
    return null;
  },
  decisions: {
    wordSpiritCost: (a, api) =>
      a.player.heroState.sorcery < 4 ? cheapCards(a, api) : null,
    guardianSpirit: cheapCovered,
    guardianWord: cheapCards,
    wordOverflow: cheapCovered,
    forbiddenMystery: ({ player }) => player.coveredCount < 2,
    forbiddenTargets: discardTarget,
    trueWordCard: ({ request, game }) =>
      [...request.choices].sort((a, b) => {
        const score = (id) => {
          const c = game.cards.get(id);
          return c.type === "spell" ? 4 : c.fates.includes("Y") ? 3 : 1;
        };
        return score(b.value) - score(a.value);
      })[0].value,
    trueWordTarget: (a, api) =>
      a.context.card?.name === "holyShield"
        ? [...a.request.choices].sort(
            (x, y) =>
              Number(a.state.players[y.value].team === a.player.team) -
              Number(a.state.players[x.value].team === a.player.team),
          )[0].value
        : damageTarget(a, api, a.context.card?.type === "attack" ? 2 : 1),
    wordExtra: () => true,
    wordDamageTarget: damageTarget,
    suppressionTarget: damageTarget,
    mysticContinuation: ({ request, player }) =>
      request.choices.find((c) => c.value === "word")?.value ??
      (player.coveredCount
        ? request.choices.find((c) => c.value === "suppress")?.value
        : null) ??
      request.choices.find((c) => c.value === "fairy")?.value ??
      "end",
    fairyAttackCard: ({ request, source }) => [
      request.valid
        .slice()
        .sort(
          (a, b) =>
            Number(source.hand[b].name === "darkStrike") -
            Number(source.hand[a].name === "darkStrike"),
        )[0],
    ],
    fairyAttackTarget: (a, api) => damageTarget(a, api, 2),
  },
};
