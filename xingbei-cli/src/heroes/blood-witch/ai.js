const fateDelta=player=>player.heroState.form?1:-2;
function bleedingPressure(state, id, api) {
 const player = state.players[id];
 if (!player.heroState.form || api.terminal(state)) return 0;
 const next = api.copy(state);
 api.hurt(next, id, 1);
 return Math.max(0, api.evaluate(state) - api.evaluate(next));
}
function moveFate(state,id,targetId,api){
 const next=api.copy(state),player=next.players[id],previous=player.heroState.linkedPlayerId,delta=fateDelta(player);
 const affected=new Set([id,previous,targetId].filter(value=>value!=null));
 if(previous!=null)for(const target of new Set([id,previous]))next.players[target].limit-=delta;
 player.heroState.linkedPlayerId=targetId;
 if(targetId!=null)for(const target of new Set([id,targetId]))next.players[target].limit+=delta;
 const seats = next.players.length;
 const ordered = [...affected].sort((a,b)=>(a-id+seats)%seats-(b-id+seats)%seats);
 for (const target of ordered) {
  if (api.terminal(next)) break;
  api.overflow(next,target);
 }
 return next;
}
function fateOptions(state,id,api,targets=null){
 const player=state.players[id],previous=player.heroState.linkedPlayerId;
 const choices=targets??[null,...state.players.filter(p=>p.id!==previous).map(p=>p.id)];
 return choices.map(targetId=>{
  const next=moveFate(state,id,targetId,api);
  // Future capacity matters even when the current hand is not full. This is
  // public pressure, not a guess at the identities of an opponent's cards.
  const capacity=next.players.reduce((n,p)=>n+(p.team===player.team?1:-1)*(p.limit-state.players[p.id].limit)*3,0);
  return {state:next,targetId,score:api.evaluate(next)+capacity-bleedingPressure(next,id,api)};
 }).sort((a,b)=>b.score-a.score);
}
function sorrowOptions(state,id,api){
 const next=api.copy(state),player=next.players[id],morale=next.teams[player.team].morale;
 api.hurt(next,id,2);
 if(api.terminal(next))return [{state:next,targetId:null,score:api.evaluate(next)}];
 if(!player.heroState.form&&next.teams[player.team].morale<morale){
  player.heroState.form='bleeding';api.heal(next,id,1);
  const linked=player.heroState.linkedPlayerId;
  if(linked!=null)for(const target of new Set([id,linked]))next.players[target].limit+=3;
 }
 return fateOptions(next,id,api);
}
function followScore(game,state,id,api){
 return Math.max(api.bestAttackScore(game,id,state).score,api.bestSpellFollow(game,id,state));
}
export const bloodWitchAi={
 id:'bloodWitch',
  energyPreference: "gem",acceptsRefine:a=>a.stones.crystal===0,
 cardBonus:({card})=>card.uniqueSkills.includes('bloodLament')?42:0,
 resourceValue:p=>p.energy.gem*4+(p.heroState.form?5:0),
 refineBonus:({player,gem})=>gem&&!player.energy.gem?5:0,
 scoreSkill({state,next,id,player,skillId,targetId,action},api){
  if(skillId==='reverseFlow'){api.heal(next,id,1);return 0;}
  if(skillId==='bloodCurse'){api.hurt(next,targetId,2);if(!api.terminal(next))api.discardEstimate(next,id,3);return 0;}
  if(skillId==='bloodLament'){const n=Number(action.mode??1);api.hurt(next,targetId,n);if(!api.terminal(next))api.hurt(next,id,n);return 0;}
  if(skillId==='sharedFate'){
   api.draw(next,id,2);
   if (api.terminal(next)) return 0;
   const prepared=moveFate(next,id,targetId,api);
   next.players=prepared.players;
   next.teams=prepared.teams;
   if (api.terminal(next)) return 0;
   const target=next.players[targetId];
   if (player.heroState.form) {
    const capacity=targetId===id?0:(target.team===player.team?6:-6);
    return capacity-bleedingPressure(next,id,api);
   }
   if(target.team===player.team)return 0;
   const ownLoss=Math.max(0,state.teams[player.team].morale-next.teams[player.team].morale);
   const enemyLoss=Math.max(0,state.teams[target.team].morale-next.teams[target.team].morale);
   // Establishing the low-hand-limit link is worth a safe hand refresh. Keep
   // the last few morale points expensive and retain the full terminal cost.
   const safety=Math.min(1,Math.max(0,(next.teams[player.team].morale-3)/5));
   const rebuild=Math.min(2,ownLoss)*24*safety;
   return rebuild+enemyLoss*8+4;
  }return null;
 },
 preparations({game,state,id,player,options},api){
  if(player.heroState.linkedPlayerId==null)return options;
  const best=sorrowOptions(state,id,api)[0];
  if(!api.terminal(best.state)&&best.score-api.evaluate(state)+followScore(game,best.state,id,api)-followScore(game,state,id,api)>0.5)
   options.push({state:best.state,activated:'bloodSorrow'});
  return options;
 },
 decisions:{
  bloodSorrow({game,player,state,id},api){
   if(player.heroState.linkedPlayerId==null)return false;
   const best=sorrowOptions(state,id,api)[0];
   return !api.terminal(best.state)&&best.score-api.evaluate(state)+followScore(game,best.state,id,api)-followScore(game,state,id,api)>0.5;
  },
  bloodSorrowMode:({state,id},api)=>fateOptions(state,id,api)[0].targetId==null?'remove':'move',
  sharedFate:({request,state,id},api)=>fateOptions(state,id,api,request.choices.map(c=>c.value))[0].targetId,
 },
};
