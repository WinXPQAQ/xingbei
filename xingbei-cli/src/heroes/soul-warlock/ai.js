export const soulWarlockAi={
 id:'soulWarlock',acceptsRefine:a=>a.stones.crystal===0,
 cardBonus:({card,retained})=>card.uniqueSkills.some(s=>['soulTreasure','soulGrant'].includes(s))?38:card.type==='spell'&&retained.filter(c=>c.type==='spell').length<2?10:0,
 resourceValue:p=>(p.heroState.yellowSoul??0)*3+(p.heroState.blueSoul??0)*3+p.energy.gem*3,
 refineBonus:({player,gem})=>gem&&!player.energy.gem?5:0,
 scoreSkill({next,id,player,skillId,costs,targetId},api){
  if(skillId==='soulRecall'){player.heroState.blueSoul=Math.min(6,player.heroState.blueSoul+costs.length);return 0;}
  if(skillId==='soulMirror'){player.heroState.yellowSoul-=2;api.draw(next,targetId,Math.min(2,Math.max(0,next.players[targetId].limit-next.players[targetId].count)));return 0;}
  if(skillId==='soulTreasure'){player.heroState.yellowSoul-=3;const p=next.players[targetId];api.hurt(next,targetId,3+(p.count<3&&p.limit>5?2:0));return 0;}
  if(skillId==='soulGrant'){player.heroState.blueSoul-=3;const p=next.players[targetId];p.energy.gem+=Math.min(2,p.energyLimit-p.energy.gem-p.energy.crystal);return p.team===player.team?5:-5;}
  return null;
 },
 decisions:{
  soulAmplify:({player})=>(player.heroState.yellowSoul<5||player.heroState.blueSoul<5),
  soulLink({request,state,player,id}){if(request.type==='skillChoice')return true;return [...request.choices].sort((a,b)=>(state.players[b.value].limit-state.players[b.value].count)-(state.players[a.value].limit-state.players[a.value].count))[0].value;},
  soulTransfer({request,state,context},api){
   const original=state.players[context.targetId],other=state.players[context.transferTargetId];
   const reducer=other.hero==='bard'&&other.heroState.form?1:0;
   const n=Math.max(0,Math.min(context.actual-Math.max(0,original.limit-original.count),Math.max(0,other.limit-other.count)+reducer));
   return Math.max(...request.choices.filter(c=>c.value<=n).map(c=>c.value));
  },
  soulConvert({source,player}){const wantYellow=source.hand.some(c=>c.uniqueSkills.includes('soulTreasure')),wantBlue=source.hand.some(c=>c.uniqueSkills.includes('soulGrant'));if(wantYellow&&player.heroState.yellowSoul<3&&player.heroState.blueSoul)return 'blueSoul';if(wantBlue&&player.heroState.blueSoul<3&&player.heroState.yellowSoul)return 'yellowSoul';return 'skip';},
 },
};
