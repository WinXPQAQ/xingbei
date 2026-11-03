import { damageTarget, usefulExtra } from "../shared/ai/decisions.js";
export const templarAi = {
  id: "templar",
  cardBonus: ({ card }) =>
    card.type === "attack" && card.fates.includes("S")
      ? 18
      : card.type === "spell"
        ? 2
        : 0,
  resourceValue: (p) =>
    (p.heroState.holySeals ?? 0) * 4 + (p.heroState.form ? 8 : 0),
  refineBonus: ({ crystal, player }) =>
    crystal && !player.energy.crystal ? 7 : 0,
  scoreSkill({ next, id, player, targetId, action, skillId }, api) {
    if (skillId === "divineDescent") {
      player.heroState.holySeals = Math.min(4, player.heroState.holySeals + 2);
      return player.hand.some((c) => c.type === "attack") ? 8 : 0;
    }
    if (skillId === "holyOracle") {
      const n = Number(action.mode);
      player.heroState.holySeals -= n;
      api.heal(next, targetId, n);
      api.discardEstimate(next, id, 1);
      return player.hand.some((c) => c.type === "attack") ? 6 : 0;
    }
    return null;
  },
  decisions: {
    divineMight: ({ player, context, state }) =>
      context.canCounter !== false &&
      state.players[context.targetId].count >= 3,
    holyJudgment: ({ request, context, state, player }) =>
      state.players[context.targetId].count >=
      state.players[context.targetId].limit - 1
        ? Math.max(...request.choices.map((c) => c.value))
        : 0,
    divineChildTarget: damageTarget,
    flamePrayer: ({ request, player, state }) =>
      request.type === "skillChoice"
        ? state.players.some(
            (p) => p.team === player.team && p.healing < p.healingLimit,
          )
        : undefined,
  },
};
