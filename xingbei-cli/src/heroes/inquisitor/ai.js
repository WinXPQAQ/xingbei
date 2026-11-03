import {
  damageTarget,
  discardTarget,
  cheapCards,
} from "../shared/ai/decisions.js";
export const inquisitorAi = {
  id: "inquisitor",
  cardBonus: ({ card, retained }) =>
    card.type === "spell" &&
    retained.filter((c) => c.type === "spell").length < 2
      ? 14
      : card.fates.includes("S")
        ? 5
        : 0,
  resourceValue: (p) =>
    (p.heroState.courtHealing ?? 0) * 2 + (p.heroState.rulings ?? 0) * 3,
  refineBonus: ({ crystal, player }) =>
    crystal && !player.energy.crystal ? 5 : 0,
  scoreSkill({ next, id, player, targetId, action, skillId }, api) {
    if (skillId === "graceBestowal") {
      const target = next.players[targetId];
      return (
        Math.min(
          2,
          target.energyLimit - target.energy.gem - target.energy.crystal,
        ) *
          5 -
        (player.heroState.courtHealing >= 3 ? 3 : 6)
      );
    }
    if (skillId === "divineSpur") {
      const n = Number(action.mode);
      player.heroState.rulings -= n;
      for (const target of action.targetIds) api.draw(next, target, 1);
      api.discardEstimate(next, id, n);
      return 0;
    }
    return null;
  },
  decisions: {
    adjudicate: ({ player, request }) =>
      player.heroState.courtHealing <= 2 &&
      player.energy.gem + player.energy.crystal > (request.reservedEnergy ?? 0),
    verdict: ({ player }) => player.heroState.courtHealing < 4,
    purificationArt: ({ player }) =>
      player.count >= player.limit || player.healing < player.healingLimit,
    purificationCost: cheapCards,
    shelterDomain: ({ context, state }) => {
      const p = state.players[context.targetId];
      return p.count + context.amount - p.healing > p.limit;
    },
    graceCost: ({ request }) =>
      request.choices.find((c) => c.value === "court")?.value ?? "team",
    graceHealing: ({ request, state }) =>
      [...request.choices].sort(
        (a, b) =>
          state.players[b.value].healing - state.players[a.value].healing,
      )[0].value,
    graceStones: ({ request }) =>
      [...request.choices].sort(
        (a, b) =>
          b.value
            .split(":")
            .map(Number)
            .reduce((x, y) => x + y) -
          a.value
            .split(":")
            .map(Number)
            .reduce((x, y) => x + y),
      )[0].value,
    graceReveal: () => true,
    graceTarget: damageTarget,
  },
};
