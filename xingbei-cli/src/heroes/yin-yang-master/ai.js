import { damageTarget } from '../shared/ai/decisions.js';
export const yinYangMasterAi={
 id:'yinYangMaster',
 defendedPlayer:r=>r.protectedTargetId,
 responseCost:r=>r.skillId==='shikigamiBinding'?10:0,
 cardBonus:({card,player,retained})=>card.type==='attack'&&!retained.some(c=>c.fates.some(f=>card.fates.includes(f)))?10:0,
 resourceValue:p=>(p.heroState.ghostFire??0)*2+(p.heroState.form?4:0)+p.energy.crystal*3,
 scoreSkill({next,id,player,skillId,targetId,action},api){
  if(skillId==='shikigamiDescent'){player.heroState.form='shikigami';player.heroState.ghostFire=Math.min(3,player.heroState.ghostFire+1);return player.hand.some(c=>c.type==='attack')?10:0;}
  if(skillId==='lifeBarrier'){
   player.heroState.ghostFire=Math.min(3,player.heroState.ghostFire+1);
   if(action.mode==='reset'){player.heroState.form=null;api.discardEstimate(next,targetId,1);}
   else {const p=next.players[targetId];p.energy.gem+=Number(p.energy.gem+p.energy.crystal<p.energyLimit);api.heal(next,targetId,1);api.hurt(next,id,player.heroState.ghostFire,'spell',{moraleLoss:player.heroState.ghostFire!==3});}
   return 0;
  }return null;
 },
 decisions:{yinYangConvert:()=>true,shikigamiConvert:({player})=>player.heroState.ghostFire<3&&player.count<player.limit,
 darkRitual:(a,api)=>damageTarget(a,api,2),shikigamiStones:()=> 'mixed'},
};
