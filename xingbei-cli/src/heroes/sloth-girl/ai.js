import { cheapCards } from "../shared/ai/decisions.js";
function resting(a, api, firstTarget) {
  const next = api.copy(a.state), player = next.players[a.id];
  if (!next.players[firstTarget].healingDisabled) api.heal(next, firstTarget, 1);
  if (player.energy.gem > 0) {
    api.payEnergy(next, a.id, 1, "gem");
    const cheapest = api.chooseAiDiscard(a.game, a.id, 1);
    api.remove(next, a.id, cheapest.map((i) => player.hand[i]));
    let overflow = false;
    for (const ally of next.players.filter((p) => p.team === player.team && p.id !== a.id)) {
      if (ally.healingDisabled) continue;
      overflow ||= ally.healing >= ally.healingLimit;
      api.heal(next, ally.id, 1);
    }
    if (overflow) next.teams[player.team].morale = Math.min(15, next.teams[player.team].morale + 1);
  }
  return api.evaluate(next) - api.evaluate(a.state);
}
function restTargets(a, api) {
  return a.state.players.filter((p) => p.team === a.player.team && p.id !== a.id)
    .map((p) => ({ id: p.id, score: resting(a, api, p.id) }))
    .sort((x, y) => y.score - x.score);
}
export const slothGirlAi = {
  id: "slothGirl",
  energyPreference: "gem",
  cardBonus: ({ same, card }) => (same ? 8 : card.type === "spell" ? 5 : 0),
  scoreSkill({ next, id, player, skillId, targetId }, api) {
    if (skillId === "wantMagicBullet") {
      api.hurt(next, targetId, 2);
      return -2;
    }
    if (skillId === "leaveMeAlone") {
      api.discardEstimate(next, id, 1);
      api.stones(next, player.team, "crystal", 1);
      const t = next.players
        .filter((t) => t.team !== player.team)
        .sort((a, b) => b.count - a.count)[0];
      api.draw(next, t.id, 2);
      return 3;
    }
    return null;
  },
  spellActions: ({ player }) => player.count ? [{
    type: "skill", skillId: "leaveMeAlone", cardIds: [], targetIds: [],
  }] : [],
  sharedDecisionSkills: ["slothResponse", "slothDrawTarget"],
  decisions: {
    slothDrawTarget: ({ request, state }) =>
      [...request.choices].sort(
        (a, b) =>
          state.players[b.value].count -
          state.players[b.value].limit -
          (state.players[a.value].count - state.players[a.value].limit),
      )[0].value,
    slothResponse: (a, api) =>
      a.player.count >= a.player.limit ? cheapCards(a, api) : null,
    letMeRestOffer: (a, api) => {
      const rest = restTargets(a, api)[0]?.score ?? -Infinity;
      const action = Math.max(api.bestAttackScore(a.game, a.id, a.state).score,
        api.bestSpellFollow(a.game, a.id, a.state));
      return rest > action;
    },
    letMeRest: (a, api) => restTargets(a, api)
      .find((p) => a.request.choices.some((c) => c.value === p.id))?.id ?? a.request.defaultValue,
    slothStone: ({ request }) =>
      request.choices.find((c) => c.value === "crystal")?.value ??
      request.defaultValue,
    slothMagicResponse: (a, api) =>
      a.player.count + (a.context.amount ?? 2) - a.player.healing >
      a.player.limit
        ? cheapCards(a, api)
        : null,
  },
};
