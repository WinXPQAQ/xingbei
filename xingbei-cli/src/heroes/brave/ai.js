export const braveAi={
 id:'brave',resourceValue:p=>(p.heroState.rage??0)*2+(p.heroState.intellect??0)*1.5,
 cardBonus:({card,elements})=>card.type==='spell'?8:elements.some(e=>['fire','water'].includes(e))?12:0,
 scoreSkill({skillId,player,next,targetId},{}) {if(skillId!=='provocation')return null;player.heroState.rage--;player.heroState.intellect=Math.min(4,player.heroState.intellect+1);return next.players[targetId].count<3?4:0;},
 sharedDecisionSkills:['provocation'],
 decisions:{
  roar:({request,player})=>request.type==='skillChoice'?true:Number(player.count<player.limit),
  stillMind:({context})=>context.canCounter!==false,
  forbiddenPower:({source,context})=>context.hit?source.hand.filter(c=>c.element==='fire').length>=2:source.hand.filter(c=>c.type==='spell').length>=2,
  deathMatch:({player,context})=>player.count+(context.actual??0)>player.limit+1||(player.heroState.rage??0)<2,
  provocation:({request})=>request.choices.some(c=>c.value==='attack')?'attack':'skip',
 }
};
