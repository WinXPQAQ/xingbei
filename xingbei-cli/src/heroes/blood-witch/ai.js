const fateDelta=player=>player.heroState.form?1:-2;
function moveFate(state,id,targetId,api){
 const next=api.copy(state),player=next.players[id],previous=player.heroState.linkedPlayerId,delta=fateDelta(player);
 const affected=new Set([id,previous,targetId].filter(value=>value!=null));
 if(previous!=null)for(const target of new Set([id,previous]))next.players[target].limit-=delta;
 player.heroState.linkedPlayerId=targetId;
 if(targetId!=null)for(const target of new Set([id,targetId]))next.players[target].limit+=delta;
 for(const target of affected){const p=next.players[target];api.discardEstimate(next,target,Math.max(0,p.count-p.limit));}
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
  return {state:next,targetId,score:api.evaluate(next)+capacity};
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
 scoreSkill({next,id,player,skillId,targetId,action},api){
  if(skillId==='reverseFlow'){api.heal(next,id,1);return 0;}
  if(skillId==='bloodCurse'){api.hurt(next,targetId,2);if(!api.terminal(next))api.discardEstimate(next,id,3);return 0;}
  if(skillId==='bloodLament'){const n=Number(action.mode??1);api.hurt(next,targetId,n);if(!api.terminal(next))api.hurt(next,id,n);return 0;}
  if(skillId==='sharedFate'){
   api.draw(next,id,2);const prepared=moveFate(next,id,targetId,api);
   next.players=prepared.players;
   return targetId===id?0:(next.players[targetId].team===player.team?1:-1)*fateDelta(player)*6;
  }return null;
 },
 preparations({state,id,player,options},api){
  if(player.heroState.linkedPlayerId==null)return options;
  const best=sorrowOptions(state,id,api)[0];
  if(!api.terminal(best.state))options.push({state:best.state,activated:'bloodSorrow'});
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
