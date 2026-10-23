export const adjudicatorAi = {
  id: "adjudicator",
  resourceValue: (p) => p.energy.gem * 3 + p.energy.crystal * 4 + (p.heroState.judgment ?? 0) * 3 + (p.heroState.form ? 3 : 0),
  refineBonus: ({ player, gem }) => gem && !player.energy.gem ? 3 : 0,
  afterDamage({ player, actual }) {
    if (actual > 0) player.heroState.judgment = Math.min(4, (player.heroState.judgment ?? 0) + 1);
  },
  scoreSkill({ next, id, player, action, targetId, skillId }, { hurt, draw, stones }) {
    if (skillId === "finalJudgment") {
      if (next.players[targetId].team === player.team) return null;
      const amount = player.heroState.judgment ?? 0;
      player.heroState.judgment = 0; player.heroState.requiredJudgment = false;
      hurt(next, targetId, amount);
      return 0;
    }
    if (skillId === "judgmentBalance") {
      player.heroState.judgment = Math.min(4, (player.heroState.judgment ?? 0) + 1);
      if (action.mode === "refill") { draw(next, id, Math.max(0, player.limit - player.count)); stones(next, player.team, "gem", 1); }
      else { player.hand = []; player.count = 0; }
      return 0;
    }
    return null;
  },
  decisions: {
    judgmentRitual({ id, state, request, player }, { energy, copy, payEnergy, lowerHandLimit, terminal, evaluate }) {
      if (request.type !== "skillChoice") return;
      if (player.energy.gem <= 0 || energy(player) <= (request.reservedEnergy ?? 0) || player.count > 5) return false;
      const next = copy(state); payEnergy(next, id, 1, "gem"); next.players[id].heroState.form = "审判"; lowerHandLimit(next, id, 5);
      return !terminal(next) && evaluate(next) - evaluate(state) + 3 > 0;
    },
    ritualBreak({ state, request, player }) {
      if (request.type !== "skillChoice") return;
      const team = state.teams[player.team];
      return (player.count >= player.limit && team.morale <= 7) || (team.cups === 4 && team.gem + team.crystal === 2) ||
        ((player.heroState.judgment ?? 0) >= 3 && team.gem + team.crystal < 5);
    },
  },
};
