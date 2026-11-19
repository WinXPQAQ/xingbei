import { damageTarget, cheapCovered } from "../shared/ai/decisions.js";
export const butterflyDancerAi = {
  id: "butterflyDancer",
  energyPreference: "mixed",
  activationReactions({ player, event }) {
    if (event.kind !== "damage" || event.damageType !== "spell" || !player.coveredCount) return [];
    const reactions = [];
    if (player.skillIds.includes("poisonPowder")) reactions.push({
      skillId: "poisonPowder", timing: "damageActualBefore", priority: 10,
      condition: "actual-spell-damage-equals-one", whenActual: 1,
      coveredCost: 1, actualDelta: 1, modeled: true,
    });
    if (player.coveredCount >= 2 && player.skillIds.includes("mirrorMoon")) reactions.push({
      skillId: "mirrorMoon", timing: "damageActualBefore", priority: 0,
      condition: "actual-spell-damage-equals-two-and-matching-cocoons", whenActual: 2,
      coveredCost: 2, hiddenCondition: true, modeled: false,
    });
    if (player.skillIds.includes("withering")) reactions.push({
      skillId: "withering", timing: "cocoonRemoved",
      condition: "removed-cocoon-is-spell", hiddenCondition: true, modeled: false,
    });
    return reactions;
  },
  cardBonus: ({ card }) => (card.type === "spell" ? 4 : 0),
  resourceValue: (p) =>
    Math.min(8, p.coveredCount ?? 0) * 3 - (p.heroState.chrysalises ?? 0) * 2,
  refineBonus: ({ player, gem }) => (gem && !player.energy.gem ? 6 : 0),
  scoreSkill({ next, id, player, skillId, costs, targetId, action }, api) {
    if (skillId === "butterflyDance") {
      if (!costs.length) api.draw(next, id, 1);
      player.coveredCount = Math.min(8, (player.coveredCount ?? 0) + 1);
      return 2;
    }
    if (skillId === "pupation") {
      player.coveredCount = Math.min(8, (player.coveredCount ?? 0) + 4);
      player.heroState.chrysalises++;
      player.limit = Math.max(3, player.limit - 1);
      return player.count > player.limit ? -5 : 1;
    }
    if (skillId === "reverseButterfly") {
      api.discardEstimate(next, id, 2);
      if (action.mode === "shed")
        return player.heroState.chrysalises > 0 && player.coveredCount >= 2
          ? 3
          : -30;
      api.applyActualDamage(next, targetId, 1, "spell");
      return 0;
    }
    return null;
  },
  decisions: {
    poisonPowder: (a, api) =>
      a.context.targetId != null &&
      a.state.players[a.context.targetId].team !== a.player.team
        ? cheapCovered(a, api)
        : null,
    pilgrimage: (a, api) =>
      a.player.count + (a.context.actual ?? 1) > a.player.limit
        ? cheapCovered(a, api)
        : null,
    mirrorMoon: (a, api) =>
      a.context.targetId != null &&
      a.state.players[a.context.targetId].team !== a.player.team
        ? cheapCovered(a, api)
        : null,
    withering: ({ player, state }) =>
      player.count + 2 <= player.limit &&
      Object.entries(state.teams).some(
        ([team, t]) => team !== player.team && t.morale > 2,
      ),
    witheringTarget: damageTarget,
    cocoonOverflow: cheapCovered,
    reverseButterflyCost: cheapCovered,
  },
};
