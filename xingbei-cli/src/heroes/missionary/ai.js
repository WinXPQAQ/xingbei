import { cheapCards, discardTarget } from "../shared/ai/decisions.js";
export const missionaryAi = {
  id: "missionary",
  sharedDecisionSkills: ["confession"],
  cardBonus: ({ card }) =>
    card.type === "spell" || card.fates.includes("S") ? 7 : 0,
  resourceValue: (p) => (p.heroState.devotion ?? 0) * 4,
  refineBonus: ({ player, crystal }) =>
    crystal && !player.energy.crystal ? 7 : 0,
  decisions: {
    preaching: () => true,
    preachingDraw: ({ player, request }) => request.choices.find(c => c.value === Number(player.count < player.limit))?.value ?? request.choices[0].value,
    spiritualGift: ({ player, request }) =>
      player.energy.gem + player.energy.crystal >
        (request.reservedEnergy ?? 0) &&
      player.healing < player.healingLimit &&
      player.count >= 4,
    service: ({ context, state, player }) =>
      state.players[context.targetId].team === player.team
        ? state.players[context.targetId].count <
          state.players[context.targetId].limit
        : true,
    revelation: ({ player }) => player.heroState.devotion >= 3,
    revelationMode: ({ player }) =>
      player.count < player.limit ? "draw" : "heal",
    revelationTarget: discardTarget,
    confession: ({ player }) => player.count + 2 <= player.limit,
    mass: ({ player, context, state, request }) =>
      player.energy.gem + player.energy.crystal >
        (request.reservedEnergy ?? 0) &&
      state.players[context.targetId].effects.length > 0,
    massMode: ({ request }) =>
      request.choices.find((c) => c.value === "take")?.value ?? "place",
    massCost: cheapCards,
  },
};
