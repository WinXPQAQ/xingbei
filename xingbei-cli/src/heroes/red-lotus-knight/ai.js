export const redLotusKnightAi = {
 id:'redLotusKnight', resourceValue:p=>(p.heroState.bloodSeals??0)*3,
 cardBonus:({card,retained})=>card.type==='spell'&&retained.filter(c=>c.type==='spell').length<2?8:0,
 scoreSkill({next,id,targetId,skillId,player},{hurt}) { if(skillId!=='scarletCross')return null;hurt(next,id,4);hurt(next,targetId,3);return 0; },
 decisions:{
  scarletCovenant:()=>true,
  bloodPrayer:({request,player})=>request.type==='skillChoice'?player.heroState.bloodSeals<2:request.type==='numberChoice'?0:undefined,
  slaughterFeast({state,id,player,context},{damageGain}) {return damageGain(state,id,context.targetId,context.amount+2,'attack')-damageGain(state,id,context.targetId,context.amount,'attack')+damageGain(state,id,id,4)>2;},
  temperance:({request,game,id,player})=>request.type==='skillChoice'?player.count<player.limit&&game.player(id).hand.some(c=>c.type==='attack'):'attack',
 }
};
