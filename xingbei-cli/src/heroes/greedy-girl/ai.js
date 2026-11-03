import { cheapCards } from "../shared/ai/decisions.js";
export const greedyGirlAi = {
  id: "greedyGirl",
  cardBonus: ({ card, elements }) =>
    card.type === "spell"
      ? 14
      : elements.some((e) => ["thunder", "fire"].includes(e))
        ? 6
        : 0,
  refineBonus: ({ player, crystal }) =>
    !player.energy.crystal && crystal ? 5 : 0,
  scoreSkill({ next, id, player, action, skillId, targetId }, api) {
    if (skillId === "greedBlackHole") {
      api.stones(next, player.team, "crystal", 1);
      api.hurt(next, targetId, 2);
      return 5;
    }
    if (skillId === "alchemy") {
      api.hurt(next, targetId, 2);
      api.stones(next, player.team, "crystal", 1);
      return -2;
    }
    if (skillId === "deadGirlsVault") {
      for (const t of action.targetIds) api.hurt(next, t, 1);
      return 1;
    }
    return null;
  },
  sharedDecisionSkills: ["blackHoleResponse"],
  decisions: {
    blackHoleResponse: (a, api) =>
      a.player.count >= a.player.limit - 1 ? cheapCards(a, api) : null,
    emptyVault: ({ state, player, context }) => {
      const t = state.teams[player.team];
      return (
        t.cups < 4 &&
        t.gem + t.crystal >= 2 &&
        (t.gem > 1 ||
          context.targetIds.some(
            (id) => state.players[id].count >= state.players[id].limit - 1,
          ))
      );
    },
  },
};
