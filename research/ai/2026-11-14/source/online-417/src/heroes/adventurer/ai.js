export const adventurerAi={
 id:'adventurer',energyPreference:'crystal',cardBonus:({same})=>same?8:0,
 resourceValue:p=>p.energy.crystal*3,
 scoreSkill({game,skillId,next,id,player,action,targetId},api) {
  if(skillId==='deception'){
   api.hurt(next,targetId,2,'attack',{sourceId:id});
   player.energy.crystal+=Math.min(1,Math.max(0,(player.energyLimit??3)-player.energy.gem-player.energy.crystal));
   return action.mode==='dark'?2:-3;
  }
  if(skillId==='adventurerParadise'){
   const[gem,crystal]=(action.mode??'0:1').split(':').map(Number);
   const readiness=api.energyGiftBonus(next,targetId,{gem,crystal});
   next.teams[player.team].gem-=gem;next.teams[player.team].crystal-=crystal;
   next.players[targetId].energy.gem+=gem;next.players[targetId].energy.crystal+=crystal;
   if(player.energy.gem+player.energy.crystal)api.payEnergy(next,id,1,'crystal');
   return readiness+(gem+crystal===2?5:-12);
  }
  if(skillId==='sleightOfHand'){
   const team=next.teams[player.team],blue=team.crystal;
   const gemNeed=next.players.filter(p=>p.team===player.team&&p.id!==id)
    .reduce((sum,p)=>sum+Math.max(0,api.energyGiftBonus(next,p.id,{gem:1,crystal:0})-
      api.energyGiftBonus(next,p.id,{gem:0,crystal:1})),0);
   if(action.mode==='steal'){
    next.teams[player.team==='red'?'blue':'red'].gem--;api.stones(next,player.team,'gem',1);
   }else{team.gem+=team.crystal;team.crystal=0;}
   const follow=Math.max(api.bestAttackScore(game,id,next).score,api.bestSpellFollow(game,id,next));
   return follow+(action.mode==='convert'&&blue>=2?Math.min(12,gemNeed*blue/2):0);
  }
  return null;
 },
 decisions:{sleightOfHand:({game,id,state},api)=>api.bestAttackScore(game,id,state).score>=
  api.bestSpellFollow(game,id,state)?'attack':'spell'},
};
