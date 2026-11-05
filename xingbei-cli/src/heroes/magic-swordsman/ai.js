// Shadow costs and the single fire follow-up are evaluated together.
function fireFollow(game,id,state,api) {
  if(api.terminal(state)||state.turn?.usedSkills?.asuraCombo)return 0;
  const player=state.players[id],fires=player.hand.filter(c=>c.type==='attack'&&(c.traits?.[id]?.elements??c.elements).includes('fire'));
  if(!fires.length)return 0;
  const best=api.bestAttackScore(game,id,state,{element:'fire'});
  // Spending the only fire leaves a real response gap. This small opportunity
  // cost never overrides a winning attack and vanishes with another fire left.
  const gap=fires.length===1&&!player.hand.some(c=>['holyLight','darkStrike'].includes(c.name))?2.5:0;
  return Math.max(0,best.score-gap);
}
function fireBranches(game,id,branches,api) {
  return branches.reduce((sum,b)=>sum+b.probability*fireFollow(game,id,b.state,api),0);
}
export const magicSwordsmanAi = {
  id: "magicSwordsman",
  activationStateFields: ["form"],
  activationEvents({ player, id, intent }) {
    if (player.heroState.form || !player.skillIds.includes("shadowGathering") || ["buy", "purchase", "synthesize", "refine", "end"].includes(intent?.type)) return [];
    return [{ kind: "damage", skillId: "shadowGathering", sourceId: id, targetId: id, damageType: "spell", amount: 1 }];
  },
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
  followAttackScore({ game, id, state, active, branches }, api) {
    if (!active || state.turn?.usedSkills?.asuraCombo) return 0;
    return fireBranches(game,id,branches,api);
  },
  scoreSkill({ next, player, targetId, skillId }, { hurt }) {
    if (skillId !== "shadowMeteor" || !player.heroState.form || next.players[targetId].team === player.team) return null;
    hurt(next, targetId, 2);
    return 0;
  },
  preparations({ state, id, player, card, action, options }, { previewActivationDamage, terminal }) {
    if (player.heroState.form) return options;
    const prepared = previewActivationDamage(state, { kind: "damage", skillId: "shadowGathering", sourceId: id, targetId: id, damageType: "spell", amount: 1 });
    for (const branch of prepared.branches) if (!terminal(branch.state)) {
      branch.state.players[id].heroState.form = "暗影";
      branch.state.shadowGatheringLoss=state.teams[player.team].morale-branch.state.teams[player.team].morale;
    }
    const option = { ...prepared, activated: "shadowGathering" };
    if (action.skillId === "shadowMeteor") return [option];
    if (card?.type === "attack") options.push(option);
    return options;
  },
  actionBonus({state,player}) {
    if(state.shadowGatheringLoss==null)return 0;
    const own=state.teams[player.team].morale,enemy=state.teams[player.team==='red'?'blue':'red'].morale;
    return state.shadowGatheringLoss===0?2:own<=6&&enemy-own>=4?-6:0;
  },
  decisions: {
    shadowGathering({ game, id, state, request }, { activationUseful }) {
      if (request.type !== "skillChoice") return;
      if ((request.reservedSkillId ?? game.turn.state?.reservedSkillId) === "shadowMeteor") return true;
      return activationUseful(game, id, state, request, "shadowGathering");
    },
    asuraCombo({ game, id, state, request }, api) {
      if (request.type === "skillChoice") return fireFollow(game,id,state,api)>0;
    },
    hadesTremor({ game, id, state, request, context }, api) {
      if (request.type !== "skillChoice") return;
      if (!context.card || context.targetId == null) return false;
      const before = api.attackOutcomes(game, id, state, context.card, context.targetId, { active: true, alreadyPlayed: true });
      const after = api.attackOutcomes(game, id, state, context.card, context.targetId, { active: true, variant: true, alreadyPlayed: true });
      return after.length && before.length &&
        api.scoreBranches(after)+fireBranches(game,id,after,api)>
        api.scoreBranches(before)+fireBranches(game,id,before,api)+0.5;
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
