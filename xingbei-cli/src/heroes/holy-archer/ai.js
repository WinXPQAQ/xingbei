import { discardTarget } from '../shared/ai/decisions.js';
export const holyArcherAi={
 id:'holyArcher',
 cardBonus:({card,retained})=>card.type==='attack'?(card.fates.includes('S')?23:retained.some(c=>c.type==='attack'&&c.elements.some(e=>card.elements.includes(e)))?7:0):5,
 resourceValue:p=>(p.heroState.faith??0)*4+(p.heroState.cannon??0)*2+(p.heroState.form?5:0)+p.energy.gem*3+p.energy.crystal*2,
 attackDamage:({active,card,player})=>active&&!(card.getTraits?.({playerId:player.id}).fates??card.traits?.[player.id]?.fates??card.fates??[]).includes('S')?-1:0,
 attackHitBonus:({active,card,player})=>active&&(card.getTraits?.({playerId:player.id}).fates??card.traits?.[player.id]?.fates??card.fates??[]).includes('S')?4:0,
 scoreSkill({game,next,id,player,skillId,action,targetId,costs},api){
  if(skillId==='holyHurricane'){
   const element=costs[0].traits[id].elements.find(e=>costs[1].traits[id].elements.includes(e));
   const card={id:null,name:`${element}Strike`,type:'attack',elements:[element],fates:['S'],uniqueSkills:[],traits:Object.fromEntries(next.players.map(p=>[p.id,{elements:[element],fates:['S']}]))};
   const branches=api.attackOutcomes(game,id,next,card,targetId,{alreadyPlayed:true});
   return api.scoreBranches(branches)-api.evaluate(next)+branches.reduce((n,b)=>n+b.probability*(b.bonus??0),0);
  }
  if(skillId==='radiantDescent'){if(action.mode==='healing')player.healing-=2;else player.heroState.faith-=2;player.heroState.form='radiant';return 8;}
  if(skillId==='holyBurst'){
   if(action.mode==='support'){api.draw(next,id,1);player.healing=Math.max(0,player.healing-1);player.heroState.faith=Math.min(10,player.heroState.faith+1);api.heal(next,targetId,1);}
   else {const n=Number(action.mode.split(':')[1]);player.healing-=n;api.discardEstimate(next,id,n);const amount=2+action.targetIds.filter(t=>next.players[t].healing>0).length;for(const t of action.targetIds)api.hurt(next,t,amount,'attack');}return 0;
  }
  if(skillId==='radiantCannon'){
   const enemy=player.team==='red'?'blue':'red';player.heroState.faith-=4+Math.max(0,next.teams[enemy].morale-next.teams[player.team].morale);player.heroState.cannon=0;
   for(const p of next.players){if(p.count>4)api.discardEstimate(next,p.id,p.count-4);else api.draw(next,p.id,4-p.count);}
   next.teams[player.team].cups++;if(next.teams[player.team].morale<next.teams[enemy].morale)next.teams[player.team].morale=next.teams[enemy].morale;else next.teams[enemy].morale=next.teams[player.team].morale;return 0;
  }return null;
 },
 decisions:{
  holyHurricaneMiss:({player,state})=>state.players.some(p=>p.team===player.team&&p.id!==player.id&&p.count>=p.limit)?Math.min(2,player.healing):0,
  holyHurricaneTarget:(a,api)=>discardTarget(a,api,2),
  autoFill:({request,player})=>player.energy.gem&&player.heroState.faith<=8?'gem':'crystal',
  autoFillReward:({player,state})=>player.heroState.faith<4||player.healing>=player.healingLimit?'faith':player.count>=player.limit?'healing':'faith',
  radiantReset:({player})=>player.healing<player.healingLimit?'healing':'faith',
  meteorHolyShot:({request,state,player})=>!state.players.some(p=>p.team===player.team&&p.healing<p.healingLimit)?'skip':player.healing?'healing':'skip',
  radiantCannonMorale:({state,player})=>state.teams[player.team].morale<state.teams[player.team==='red'?'blue':'red'].morale?player.team:player.team==='red'?'blue':'red',
 },
};
