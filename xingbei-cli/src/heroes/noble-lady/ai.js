import { damageTarget } from "../shared/ai/decisions.js";
export const nobleLadyAi = {
  id: "nobleLady",
  cardBonus: ({ card, elements }) =>
    card.type === "spell" ||
    card.fates.includes("Y") ||
    elements.includes("water")
      ? 5
      : 0,
  refineBonus: ({ gem, player }) =>
    gem && player.energy.gem + player.energy.crystal <= 1 ? 7 : 0,
  scoreSkill({ next, id, player, skillId }, api) {
    if (skillId !== "magicLesson") return null;
    api.draw(next, id, 1);
    return player.count <= player.limit ? 5 : -5;
  },
  decisions: {
    magicSpark: ({ context, player }) =>
      !context.triggered || player.count >= 3 || context.count === 3,
    friendshipBond: ({ player }) => player.count >= player.limit - 1,
    friendshipTargets: ({ request, state }) =>
      [...request.choices].sort(
        (a, b) => state.players[b.value].count - state.players[a.value].count,
      )[0].value,
    lessonSpellTargets: damageTarget,
    lessonFateTargets: damageTarget,
    wishFulfillment: ({ player, request }) =>
      player.count !== 4 &&
      player.energy.gem + player.energy.crystal > (request.reservedEnergy ?? 0),
    sharedWish: ({ state, player, id }) =>
      state.players.some(
        (p) =>
          p.id !== id && (p.team === player.team ? p.count < 3 : p.count > 5),
      ),
    wishTarget: ({ request, state, player }) =>
      [...request.choices].sort((a, b) => {
        const score = (id) =>
          (state.players[id].team === player.team ? 1 : -1) *
          (4 - state.players[id].count);
        return score(b.value) - score(a.value);
      })[0].value,
  },
};
