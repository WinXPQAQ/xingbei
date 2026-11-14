import { estimateHeroCapabilities } from '../../ai/hero-capabilities.js';

// Estimate throughput from public plays/discards over recent own turns. No
// hero-name list and no access to the teammate's cards is needed.
function linkValue(state,targetId,id) {
 const target=state.players[targetId], history=state.actions??[];
 let turns=0,left=0;
 for(let i=history.length-1;i>=0;i--){const e=history[i];
  if(e.playerId!==targetId)continue;
  if(e.type==='turn'&&++turns>2)break;
  if(['play','discard','give'].includes(e.type))left+=e.count??1;
 }
 const capability=estimateHeroCapabilities(state,targetId);
 // Observed movement and available shedding both matter. Incoming draws and
 // exchanges are throughput, not empty hand slots: do not subtract them here.
 const flow=turns?left/Math.min(turns,2)*.6+capability.flow.outgoing*.4:capability.flow.outgoing;
 const slow=Math.max(-1,Math.min(2,2-flow));
 const pressure=target.count/Math.max(1,target.limit);
 const room=Math.max(0,state.players[id].limit-state.players[id].count);
 return slow*4+pressure*3+Math.min(2,room)*pressure;
}
export const soulWarlockAi={
 id:'soulWarlock',
  energyPreference: "gem",acceptsRefine:a=>a.stones.crystal===0,
 cardBonus:({card,retained})=>card.uniqueSkills.includes('soulTreasure')?42:card.uniqueSkills.includes('soulGrant')?32:card.type==='spell'&&retained.filter(c=>c.type==='spell').length<2?10:0,
 resourceValue:p=>(p.heroState.yellowSoul??0)*3+(p.heroState.blueSoul??0)*3+p.energy.gem*3,
 refineBonus:({player,gem})=>gem&&!player.energy.gem?5+(player.heroState.yellowSoul===1&&player.hand.some(c=>c.uniqueSkills.includes('soulTreasure'))?8:0):0,
 scoreSkill({next,id,player,skillId,costs,targetId},api){
  if(skillId==='soulRecall'){player.heroState.blueSoul=Math.min(6,player.heroState.blueSoul+costs.length);return 0;}
  if(skillId==='soulMirror'){player.heroState.yellowSoul-=2;api.draw(next,targetId,Math.min(2,Math.max(0,next.players[targetId].limit-next.players[targetId].count)));return 0;}
  if(skillId==='soulTreasure'){player.heroState.yellowSoul-=3;const p=next.players[targetId];api.hurt(next,targetId,3+(p.count<3&&p.limit>5?2:0));return 3;}
  if(skillId==='soulGrant'){player.heroState.blueSoul-=3;const p=next.players[targetId];p.energy.gem+=Math.min(2,p.energyLimit-p.energy.gem-p.energy.crystal);return p.team===player.team?0:-5;}
  return null;
 },
 decisions:{
  soulAmplify:({player})=>(player.heroState.yellowSoul<5||player.heroState.blueSoul<5),
  soulLink({request,state,player,source}){if(request.type==='skillChoice')return !(source.hand.some(c=>c.uniqueSkills.includes('soulTreasure'))&&player.heroState.yellowSoul<=3);return [...request.choices].sort((a,b)=>linkValue(state,b.value,player.id)-linkValue(state,a.value,player.id))[0].value;},
  soulTransfer({request,state,context},api){
   const original=state.players[context.targetId],other=state.players[context.transferTargetId];
   const reducer=other.hero==='bard'&&other.heroState.form?1:0;
   const n=Math.max(0,Math.min(context.actual-Math.max(0,original.limit-original.count),Math.max(0,other.limit-other.count)+reducer));
   return Math.max(...request.choices.filter(c=>c.value<=n).map(c=>c.value));
  },
  soulConvert({source,player,state}){
   const blast=source.hand.some(c=>c.uniqueSkills.includes('soulTreasure'));
   const yellow=player.heroState.yellowSoul,blue=player.heroState.blueSoul;
   if(blast){
    // One conversion completes a blast at yellow=2. At yellow=1 a gem's
    // amplification supplies both missing souls, so preserve the blue reserve.
    const gemsAvailable=player.energy.gem+state.teams[player.team].gem>0;
    if(blue>0&&yellow<3&&(yellow===2||!gemsAvailable))return 'blueSoul';
    if(yellow>3&&blue<6)return 'yellowSoul';
    return 'skip';
   }
   return yellow>0&&blue<6?'yellowSoul':'skip';
  },
 },
};
