import { cheapCards } from "../shared/ai/decisions.js";
// Both the action score and the later response compare the same public forecast.
function vaultResult(a, api, clear) {
  const next = api.copy(a.state), team = next.teams[a.player.team];
  const gems = clear ? team.gem : 0;
  const bonus = clear ? Math.floor((team.gem + team.crystal) / 2) : 0;
  if (clear) team.gem = team.crystal = 0;
  const targets = [...a.targetIds].sort((x, y) =>
    (x - a.id + next.players.length) % next.players.length -
    (y - a.id + next.players.length) % next.players.length);
  for (const target of targets) {
    api.hurt(next, target, 1 + bonus);
    if (api.terminal(next)) return next;
  }
  if (gems > 1 && targets.length) {
    next.teams[next.players[targets[0]].team].morale--;
    if (!api.terminal(next)) team.morale = Math.min(15, team.morale + 1);
  }
  return next;
}
function vaultPlan(a, api) {
  const hold = vaultResult(a, api, false), clear = vaultResult(a, api, true);
  const team = a.state.teams[a.player.team];
  const enemy = clear.teams[a.player.team === "red" ? "blue" : "red"];
  const wins = enemy.morale <= 0 && clear.teams[a.player.team].morale > 0;
  const use = team.gem + team.crystal > 0 && (team.cups < 4 || wins) &&
    api.evaluate(clear) > api.evaluate(hold);
  return { use, state: use ? clear : hold };
}
export const greedyGirlAi = {
  id: "greedyGirl",
  energyPreference: "crystal",
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
      const plan = vaultPlan({ state: next, id, player, targetIds: action.targetIds }, api);
      Object.assign(next, plan.state);
      return 1;
    }
    return null;
  },
  sharedDecisionSkills: ["blackHoleResponse"],
  decisions: {
    blackHoleResponse: (a, api) =>
      a.player.count >= a.player.limit - 1 ? cheapCards(a, api) : null,
    emptyVault: ({ state, id, player, context }, api) =>
      vaultPlan({ state, id, player, targetIds: context.targetIds ?? [] }, api).use,
  },
};
