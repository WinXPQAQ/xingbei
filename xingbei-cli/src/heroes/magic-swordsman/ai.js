// Shadow costs and the single fire follow-up are evaluated together.
export const magicSwordsmanAi = {
  id: "magicSwordsman",
  cardBonus({ card, elements, same, retained }) {
    let extra = 0;
    if (card.type === "attack" && elements.includes("fire")) extra = same ? 16 : 30;
    if (card.type === "spell") extra = retained.filter((c) => c.type === "spell").length < 2 ? 15 : -12;
    return extra;
  },
  acceptsRefine: (action) => action.stones.crystal === 0,
  resourceValue: (p) => p.energy.gem * 5 + (p.heroState.form ? 3 : 0),
  refineBonus: ({ player, gem }) => gem && !player.energy.gem ? 8 : 0,
  attackDamage: ({ player }) => player.heroState.form ? 1 : 0,
  attackVariants: ({ player, state, active }) => active && player.energy.gem > 0 && !state.turn?.usedSkills?.hadesTremor ? [false, true] : [false],
  prepareAttack({ state, id, variant }, { payEnergy }) {
    if (!variant) return;
    payEnergy(state, id, 1, "gem");
    state.turn ??= {}; state.turn.usedSkills ??= {};
    state.turn.usedSkills.hadesTremor = true;
  },
  uncounterable: ({ active, variant }) => active && variant,
  beforeAttackHit({ state, id, variant }, { draw, discardEstimate }) {
    if (!variant) return;
    draw(state, id, Math.max(0, state.players[id].limit - state.players[id].count));
    discardEstimate(state, id, 2);
  },
  followAttackScore({ game, id, state, active, branches }, { terminal, bestAttackScore }) {
    if (!active || state.turn?.usedSkills?.asuraCombo) return 0;
    return branches.reduce((sum, branch) => {
      if (terminal(branch.state)) return sum;
      return sum + branch.probability * Math.max(0, bestAttackScore(game, id, branch.state, { element: "fire" }).score);
    }, 0);
  },
  scoreSkill({ next, player, targetId, skillId }, { hurt }) {
    if (skillId !== "shadowMeteor" || !player.heroState.form || next.players[targetId].team === player.team) return null;
    hurt(next, targetId, 2);
    return 0;
  },
  preparations({ state, id, player, card, action, options }, { copy, hurt, terminal }) {
    if (player.heroState.form) return options;
    const prepared = copy(state); hurt(prepared, id, 1);
    if (!terminal(prepared)) prepared.players[id].heroState.form = "暗影";
    if (action.skillId === "shadowMeteor") return [{ state: prepared, activated: "shadowGathering" }];
    if (card?.type === "attack") options.push({ state: prepared, activated: "shadowGathering" });
    return options;
  },
  decisions: {
    shadowGathering({ game, id, state, request }, { activationUseful }) {
      if (request.type !== "skillChoice") return;
      if ((request.reservedSkillId ?? game.turn.state?.reservedSkillId) === "shadowMeteor") return true;
      return activationUseful(game, id, state, request, "shadowGathering");
    },
    asuraCombo({ game, id, state, request }, { bestAttackScore }) {
      if (request.type === "skillChoice") return bestAttackScore(game, id, state, { element: "fire" }).score > 0;
    },
    hadesTremor({ game, id, state, request, context }, { attackOutcomes, scoreBranches }) {
      if (request.type !== "skillChoice") return;
      if (!context.card || context.targetId == null) return false;
      const before = attackOutcomes(game, id, state, context.card, context.targetId, { active: true, alreadyPlayed: true });
      const after = attackOutcomes(game, id, state, context.card, context.targetId, { active: true, variant: true, alreadyPlayed: true });
      return after.length && before.length && scoreBranches(after) > scoreBranches(before) + 0.5;
    },
    shadowMeteor({ game, id, state, request, player }, { energy }) {
      if (request.type !== "numberChoice") return;
      const room = game.getEnergyLimit(id) - energy(player), team = state.teams[player.team];
      if (room <= 0 || player.energy.gem > 0 || team.cups >= 4 || team.gem + team.crystal < 4) return "keep";
      const options = request.choices.filter((c) => c.value !== "keep");
      options.sort((a, b) => Number(a.value.split(":")[0]) - Number(b.value.split(":")[0]));
      return options[0]?.value ?? "keep";
    },
  },
};
