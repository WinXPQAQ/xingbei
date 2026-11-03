import {
  cheapCards,
  cheapCovered,
  damageTarget,
  discardTarget,
} from "../shared/ai/decisions.js";
export const headMaidAi = {
  id: "headMaid",
  sharedDecisionSkills: ["calmWind"],
  cardBonus: ({ card }) => (card.type === "attack" ? 9 : 0),
  resourceValue: (p) =>
    (p.heroState.threads ?? 0) * 3 +
    (p.coveredCount ?? 0) * 3 +
    (p.heroState.form ? 3 : 0),
  attackHitBonus: ({ player, active }) =>
    active && !player.heroState.flashActive ? 4 : 0,
  uncounterable: ({ player, active }) => active && player.heroState.flashActive,
  acceptsRefine: (a) => !a.stones.crystal,
  refineBonus: ({ player }) => (!player.energy.gem ? 4 : 0),
  decisions: {
    shadowHole: () => true,
    shadowHoleTarget: discardTarget,
    trueShadow: ({ player, request }) =>
      player.coveredCount < 2 &&
      player.count >= 4 &&
      player.energy.gem > (request.reservedEnergy ?? 0),
    trueShadowCards: cheapCards,
    shadowCopy: ({ player }) => player.coveredCount < 3,
    flashKill: (a, api) =>
      a.source.hand.some((c) => c.type === "attack")
        ? cheapCovered(a, api)
        : null,
    shadowStitch: ({ request, context, state }) =>
      Math.min(
        Math.max(...request.choices.map((c) => c.value)),
        state.players[context.targetId].count + 1,
      ),
    shadowStitchCard: cheapCovered,
    shadowOverflow: cheapCovered,
    wayOfService: cheapCovered,
    serviceCard: cheapCovered,
    serviceTarget: ({ request, state, player }) =>
      [...request.choices].sort((a, b) => {
        const score = (id) => {
          const p = state.players[id];
          return p.team === player.team
            ? p.limit - p.count
            : p.count >= p.limit
              ? 3
              : -5;
        };
        return score(b.value) - score(a.value);
      })[0].value,
    shadowPrison: () => true,
    prisonRelease: () => true,
    prisonTarget: (a, api) => damageTarget(a, api, 2),
    calmWind: ({ player }) => player.count <= player.limit - 2,
  },
};
