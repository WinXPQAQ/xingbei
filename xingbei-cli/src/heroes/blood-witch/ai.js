export const bloodWitchAi={
 id:'bloodWitch',acceptsRefine:a=>a.stones.crystal===0,
 cardBonus:({card})=>card.uniqueSkills.includes('bloodLament')?42:0,
 resourceValue:p=>p.energy.gem*4+(p.heroState.form?5:0),
 refineBonus:({player,gem})=>gem&&!player.energy.gem?5:0,
 scoreSkill({next,id,player,skillId,targetId,action},api){
  if(skillId==='reverseFlow'){api.heal(next,id,1);return 0;}
  if(skillId==='bloodCurse'){api.hurt(next,targetId,2);if(!api.terminal(next))api.discardEstimate(next,id,3);return 0;}
  if(skillId==='bloodLament'){const n=Number(action.mode??1);api.hurt(next,targetId,n);if(!api.terminal(next))api.hurt(next,id,n);return 0;}
  if(skillId==='sharedFate'){
   api.draw(next,id,2);const delta=player.heroState.form?1:-2;
   for(const target of new Set([id,targetId])){const p=next.players[target];p.limit+=delta;api.discardEstimate(next,target,Math.max(0,p.count-p.limit));}
   return targetId===id?0:(next.players[targetId].team===player.team?1:-1)*delta*6;
  }return null;
 },
 decisions:{
  bloodSorrow({player,state,id}){const target=state.players[player.heroState.linkedPlayerId];return !!target&&!!player.heroState.form&&target.team!==player.team&&player.count+2-player.healing<=player.limit;},
  bloodSorrowMode:()=> 'move',
  sharedFate({request,state,player}){return [...request.choices].sort((a,b)=>{const score=id=>(state.players[id].team===player.team?1:-1)*(player.heroState.form?1:-2)*(state.players[id].count+1);return score(b.value)-score(a.value);})[0].value;},
 },
};
