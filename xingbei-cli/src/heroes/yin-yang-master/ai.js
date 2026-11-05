import { damageTarget } from '../shared/ai/decisions.js';
const fatePair = (cards,id) => cards.some((a,i)=>cards.slice(i+1).some(b=>
 (a.traits?.[id]?.fates??a.fates??[]).some(f=>(b.traits?.[id]?.fates??b.fates??[]).includes(f))));
function counterFate(request,card,id) {
 const incoming=request.context?.attackTraits?.fates??request.attack?.getTraits({playerId:request.actor?.id})?.fates??[];
 return incoming.some(f=>card.getTraits({playerId:id}).fates.includes(f));
}
export const yinYangMasterAi={
 id:'yinYangMaster', energyPreference:'crystal',
 defendedPlayer:r=>r.protectedTargetId,
 responseCost(request,{state,id},api) {
  if(request.skillId!=='shikigamiBinding')return 0;
  const next=api.copy(state),team=next.teams[next.players[id].team];
  team.gem-=team.crystal?1:2;if(team.crystal)team.crystal--;
  return Math.max(0,api.evaluate(state)-api.evaluate(next));
 },
 responseBonus({request,state,id,card},api) {
  if(!counterFate(request,card,id))return 0;
  const next=api.copy(state),p=next.players[id],wasForm=!!p.heroState.form;
  p.heroState.ghostFire=Math.min(3,p.heroState.ghostFire+1);p.heroState.form=null;
  const remaining=p.hand.filter(c=>c.id!==card.id);
  // A same-fate counter can reset the form and reopen the two-card descent.
  // The opportunity depends on actual remaining cards, not presumed next draws.
  const cycle=wasForm&&fatePair(remaining,id)?Math.min(8,Math.max(0,p.count-2)*2):0;
  return api.evaluate(next)-api.evaluate(state)+cycle;
 },
 defenseRisk({request,state,id},api) {
  if(request.skillId!=='shikigamiBinding')return 0;
  const actor=state.players[request.actor?.id],target=state.players[request.protectedTargetId];
  if(!actor||!target)return 0;
  const amount=request.damage??2,skills=new Set(actor.skillIds),energy=actor.energy.gem+actor.energy.crystal;
  let extra=0;
  if(skills.has('pitchBlackLance')&&actor.heroState.form&&!actor.heroState.released&&[1,2].includes(target.count)&&energy){
   extra+=Math.max(0,api.damageGain(state,id,target.id,amount,'attack',{sourceId:actor.id})-
    api.damageGain(state,id,target.id,amount+energy+2,'attack',{sourceId:actor.id})-energy*4);
  }
  if(skills.has('swordQiSlash')&&actor.heroState.swordQi>0){
   const n=Math.min(3,actor.heroState.swordQi);
   extra+=Math.max(0,...state.players.filter(p=>p.team===target.team&&p.id!==target.id)
    .map(p=>-api.damageGain(state,id,p.id,n,'spell',{sourceId:actor.id})-n*2));
  }
  if(skills.has('engraving')&&['demonBlade','alienBlade'].includes(request.attack?.name)){
   const next=api.copy(state);api.draw(next,target.id,1);
   extra+=Math.max(0,api.evaluate(state)-api.evaluate(next))+4;
  }
  const es=request.context?.attackTraits?.elements??request.attack?.elements??[];
  const evidence=Math.max(0,...es.map(e=>state.beliefs?.[target.id]?.[e]??0));
  // Public recent failures strengthen the expected hit, without reading whether
  // this teammate currently has a counter or a light.
  return extra*Math.min(1,0.75**target.count+evidence*.5);
 },
 cardBonus:({card,retained})=>card.type==='attack'&&!retained.some(c=>c.fates.some(f=>card.fates.includes(f)))?10:0,
 resourceValue:p=>(p.heroState.ghostFire??0)*2+(p.heroState.form?4:0)+p.energy.crystal*3,
 refineBonus:({player})=>!player.energy.gem&&!player.energy.crystal?4:0,
 scoreSkill({game,next,id,player,skillId,targetId,action},api){
  if(skillId==='shikigamiDescent'){
   player.heroState.form='shikigami';player.heroState.ghostFire=Math.min(3,player.heroState.ghostFire+1);
   return api.bestAttackScore(game,id,next).score;
  }
  if(skillId==='lifeBarrier'){
   player.heroState.ghostFire=Math.min(3,player.heroState.ghostFire+1);
   if(action.mode==='reset'){player.heroState.form=null;api.discardEstimate(next,targetId,1);return 0;}
   const p=next.players[targetId],gem=Number(p.energy.gem+p.energy.crystal<p.energyLimit);
   const support=api.energyGiftBonus(next,targetId,{gem,crystal:0});
   p.energy.gem+=gem;api.heal(next,targetId,1);
   api.hurt(next,id,player.heroState.ghostFire,'spell',{sourceId:id,moraleLoss:player.heroState.ghostFire!==3});
   return support;
  }return null;
 },
 decisions:{yinYangConvert:()=>true,shikigamiConvert:({state,id,player},api)=>{
  const next=api.copy(state);api.draw(next,id,1);next.players[id].heroState.ghostFire=Math.min(3,player.heroState.ghostFire+1);
  return api.evaluate(next)>api.evaluate(state);
 },darkRitual:(a,api)=>damageTarget(a,api,2),shikigamiStones:()=> 'mixed'},
};
