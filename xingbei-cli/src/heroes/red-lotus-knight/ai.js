// Self damage can spend healing; boiling blood prevents its later morale loss.
function selfDamage(state, id, amount, api) {
  const player = state.players[id], before = state.teams[player.team].morale;
  api.hurt(state, id, amount, 'spell', { moraleLoss: !player.heroState.form });
  if (!api.terminal(state) && state.teams[player.team].morale < before) player.heroState.form = 'boilingBlood';
}
function prayerValue(state, id, count, api) {
  const next = api.copy(state), player = next.players[id];
  player.healing -= count;
  selfDamage(next, id, count, api);
  if (!api.terminal(next)) {
    for (let i = 0; i < count; i++) {
      const ally = next.players.filter(p => p.team === player.team && p.id !== id)
        .sort((a,b) => (b.healingLimit-b.healing)-(a.healingLimit-a.healing))[0];
      if (ally) api.heal(next, ally.id, 1);
    }
    player.heroState.bloodSeals = Math.min(2, player.heroState.bloodSeals + 1);
  }
  return api.evaluate(next) - api.evaluate(state);
}
export const redLotusKnightAi = {
  id: 'redLotusKnight', energyPreference: 'crystal',
  resourceValue: p => (p.heroState.bloodSeals ?? 0) * 3,
  cardBonus: ({card,retained}) => card.type === 'spell' && retained.filter(c => c.type === 'spell').length < 2 ? 8 : 0,
  scoreSkill({next,id,targetId,skillId,player}, api) {
    if (skillId !== 'scarletCross') return null;
    player.heroState.bloodSeals--;
    selfDamage(next, id, 4, api);
    if (!api.terminal(next)) api.hurt(next, targetId, 3);
    return 0;
  },
  decisions: {
    scarletCovenant: () => true,
    bloodPrayer({request,player,state,id}, api) {
      if (request.type === 'playerChoice') return [...request.choices].sort((a,b) => {
        const x=state.players[a.value], y=state.players[b.value];
        return (y.healingLimit-y.healing)-(x.healingLimit-x.healing);
      })[0]?.value ?? request.defaultValue;
      const counts = request.type === 'numberChoice' ? request.choices.map(c=>c.value) :
        Array.from({length:player.healing}, (_,i)=>i+1);
      const best = counts.map(count=>({count,score:prayerValue(state,id,count,api)})).sort((a,b)=>b.score-a.score)[0];
      return request.type === 'skillChoice' ? !!best && best.score > 0 : best?.count ?? request.defaultValue;
    },
    slaughterFeast({state,id,context}, api) {
      const next=api.copy(state);next.players[id].heroState.bloodSeals--;
      selfDamage(next,id,4,api);
      if (api.terminal(next)) return api.evaluate(next)>api.evaluate(state);
      const extra=api.damageGain(next,id,context.targetId,context.amount+2,'attack')-
        api.damageGain(next,id,context.targetId,context.amount,'attack');
      return api.evaluate(next)-api.evaluate(state)+extra>0;
    },
    temperance({request,game,id,state},api) {
      const next=api.copy(state);api.payEnergy(next,id,1,'crystal');next.players[id].heroState.form=null;
      const attack=api.bestAttackScore(game,id,next).score, spell=api.bestSpellFollow(game,id,next);
      return request.type==='skillChoice' ? Math.max(attack,spell)+api.evaluate(next)-api.evaluate(state)>1 : attack>=spell?'attack':'spell';
    },
  },
};
