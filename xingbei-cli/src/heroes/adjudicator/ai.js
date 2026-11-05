const defensiveHand = player => {
  const cards=player.hand.filter(card=>!card.reserve);
  const coverage=new Set(cards.filter(card=>card.type==='attack').flatMap(card=>card.traits?.[player.id]?.elements??card.elements));
  return coverage.size*2+cards.filter(card=>['holyLight','darkStrike'].includes(card.name)).length*5;
};
function ritualState(state,id,api) {
  const next=api.copy(state);
  api.payEnergy(next,id,1,'gem');
  next.players[id].heroState.form='审判';
  api.lowerHandLimit(next,id,5);
  return next;
}

export const adjudicatorAi = {
  id: "adjudicator", energyPreference: "mixed",
  cardBonus: ({card,same}) => card.name==='holyLight' ? 4 : card.type==='spell' ? -22 : same ? 0 : 12,
  resourceValue: (p) => p.energy.gem * 2 + (!p.heroState.form&&p.energy.gem?9:0) + p.energy.crystal * 3 + (p.heroState.judgment ?? 0) * 3 + (p.heroState.form ? 14 : 0),
  refineBonus: ({ player, gem }) => gem && !player.energy.gem && !player.heroState.form ? 12 : 0,
  preparations({state,id,player,options},api) {
    if(player.heroState.form||!player.energy.gem)return options;
    const next=ritualState(state,id,api);
    return api.terminal(next)?options:[...options,{state:next,activated:'judgmentRitual'}];
  },
  actionBonus({game,id,action}) {
    // Defense is the ordinary use of dark; this remains a preference, so an
    // immediate winning attack is still valued by the common terminal score.
    return action.type==='play'&&game.player(id).hand[action.index]?.name==='darkStrike'?-35:0;
  },
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
      else {
        const protection=defensiveHand(player);
        player.hand = []; player.known=[]; player.count = 0;
        // Discarding every response is not a free preparation for refilling.
        return -protection;
      }
      return 0;
    }
    return null;
  },
  decisions: {
    judgmentRitual({ id, state, request, player }, api) {
      if (request.type !== "skillChoice") return;
      if (player.energy.gem <= 0 || api.energy(player) <= (request.reservedEnergy ?? 0)) return false;
      const next=ritualState(state,id,api);
      return !api.terminal(next) && api.evaluate(next)-api.evaluate(state)+4>0;
    },
    ritualBreak({ id, state, request, player }, {copy,stones,evaluate}) {
      if (request.type !== "skillChoice") return;
      const next=copy(state),p=next.players[id],team=state.teams[player.team];
      p.heroState.form=null;p.limit=6;stones(next,p.team,'gem',1);
      const fifthCup=team.cups===4&&team.gem+team.crystal===2?12:0;
      return evaluate(next)-evaluate(state)+fifthCup>1;
    },
  },
};
