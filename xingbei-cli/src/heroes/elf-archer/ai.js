import { damageTarget, cheapCards } from '../shared/ai/decisions.js';
export const elfArcherAi={
 id:'elfArcher',
 cardBonus:({card,retained,same})=>card.type==='spell'?(retained.filter(c=>c.type==='spell').length<1?13:0):!same?8:0,
 resourceValue:p=>p.coveredCount*5+p.energy.gem*4,
 refineBonus:({player,gem})=>gem&&!player.heroState.form&&!player.energy.gem?6:0,
 attackHitBonus:({state,id,active,player,card,targetId},api)=>active&&!player.heroState.elementShotUsed?(card?.elements.includes('fire')?Math.max(0,api.damageGain(state,id,targetId,3,'attack')-api.damageGain(state,id,targetId,2,'attack')-3):card?.elements.includes('earth')?Math.max(0,...state.players.map(p=>api.damageGain(state,id,p.id,1)))-3:0):0,
 decisions:{
  elfRitual:()=>true,
  elfRitualEnd:(a,api)=>damageTarget(a,api,2),
  earthArrow:(a,api)=>damageTarget(a,api,1),
  elementShot(a,api){
   const {context,source,request,state,id}=a,element=context.attackTraits?.elements?.[0];
   const value=element==='wind'?source.hand.some(c=>c.type==='attack')?12:0:element==='water'?state.players.some(p=>p.team===a.player.team&&p.healing<p.healingLimit)?5:0:element==='earth'?Math.max(...state.players.map(p=>api.damageGain(state,id,p.id,1))):element==='fire'?api.damageGain(state,id,context.targetId,3,'attack')-api.damageGain(state,id,context.targetId,2,'attack'):element==='thunder'?8:0;
   if(value<=2)return 'skip';
   // Do not spend the only Holy Light merely to acquire a small arrow bonus.
   if(request.choices.some(c=>c.value==='spell')&&source.hand.some(c=>c.type==='spell'&&c.name!=='holyLight'))return 'spell';
   if(request.choices.some(c=>c.value==='blessing'))return 'blessing';return 'skip';
  },
  elementShotCost:cheapCards,
  elementShotBlessing({request,source,game,id},api){return [...request.choices].sort((a,b)=>api.cardScore(game,id,game.cards.get(a.value))-api.cardScore(game,id,game.cards.get(b.value)))[0].value;},
  animalCompanion:({request,player})=>request.type==='skillChoice'?player.count<player.limit:undefined,
  petEnhancement(a,api){if(a.request.type==='playerChoice')return damageTarget(a,api,1);return a.state.players.some(p=>p.team!==a.player.team&&p.count>=p.limit&&api.damageGain(a.state,a.id,p.id,1)>10);},
 },
};
