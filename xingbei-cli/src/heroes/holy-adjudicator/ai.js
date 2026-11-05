import { cheapCards } from "../shared/ai/decisions.js";
const attackTarget = ({ request, state, id }, api, amount) =>
  [...request.choices].sort((a, b) => api.damageGain(state, id, b.value, amount, "attack") -
    api.damageGain(state, id, a.value, amount, "attack"))[0]?.value ?? request.defaultValue;
export const holyAdjudicatorAi = {
  id: "holyAdjudicator",
  energyPreference: "crystal",
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
    divineJudgmentTarget: (a, api) => attackTarget(a, api, 2),
    leftScaleTarget: (a, api) => attackTarget(a, api, 1),
    heavenSin: ({ source, request, game }) => {
      const open = ["leftScale", "rightScale"].filter((side) =>
        source.covered.filter((c) => c.location.pile === side).length < 3,
      ).length;
      const plan = request.activationPlan ?? game.turn.state?.activationPlan;
      const action = plan?.action;
      if (action && (action.type !== "play" || source.hand[action.index]?.type !== "attack")) return false;
      // Activation reserves are hints, not a prerequisite. A hierarchical
      // activation can have an attack intention without locking one exact card.
      return open > 0 && source.hand.some((c) => c.type === "attack") &&
        source.hand.filter((c) => c.category === "basic").length >= open + 1;
    },
    heavenSinCards: cheapCards,
    leftScaleCard: ({ request }) => request.choices[0].value,
    sinArrivesCard: cheapCards,
  },
};
