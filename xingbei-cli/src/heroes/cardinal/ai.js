import { discardTarget } from "../shared/ai/decisions.js";
export const cardinalAi = {
  id: "cardinal",
  cardBonus: ({ card }) =>
    card.type === "attack" ? 8 : card.fates.includes("S") ? 6 : 0,
  resourceValue: (p) =>
    (p.heroState.relics ?? 0) * 4 + (p.heroState.silverBullets ?? 0) * 3,
  refineBonus: ({ crystal, player }) =>
    crystal && !player.energy.crystal ? 5 : 0,
  scoreSkill({ player, skillId }) {
    if (skillId !== "authorityReversal") return null;
    player.heroState.relics = Math.min(3, player.heroState.relics + 2);
    return player.count >= 5 ? 4 : player.count < 3 ? -9 : 0;
  },
  decisions: {
    divineDeclaration: ({ request }) =>
      Math.max(...request.choices.map((c) => c.value)),
    exorcismRite: ({ state, player }) =>
      state.players.some((p) => p.team === player.team && p.count >= p.limit),
    exorcismTarget: discardTarget,
    prayerRite: ({ state, player }) =>
      state.players.some(
        (p) => p.team === player.team && p.healing < p.healingLimit,
      ),
    holyScripture: ({ state, player, request }) =>
      player.energy.gem + player.energy.crystal >
        (request.reservedEnergy ?? 0) &&
      state.players.filter((p) => p.team === player.team && p.healing === 0)
        .length >= 2,
    reversalCost: ({ request }) => request.choices[0].value,
    reversalHealing: ({ request, state }) =>
      [...request.choices].sort(
        (a, b) =>
          state.players[b.value].healing - state.players[a.value].healing,
      )[0].value,
  },
};
