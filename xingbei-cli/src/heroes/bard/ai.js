export const bardAi={
 id:'bard',cardBonus:({same,card})=>same?10:card.type==='spell'?5:0,
 resourceValue:p=>(p.heroState.inspiration??0)*2,
 scoreSkill({next,id,targetId,skillId,action,player},{draw,discardEstimate}){if(skillId!=='dissonance')return null;const[k,n]=(action.mode??'draw:2').split(':');player.heroState.inspiration-=Number(n);for(const who of[id,targetId]){if(k==='draw')draw(next,who,Number(n)-1);else discardEstimate(next,who,Number(n)-1);}return 0;},
 sharedDecisionSkills:['passionateRhapsody','victorySymphony'],
 decisions:{
  hopeFugue:({request,player})=>request.type==='skillChoice'?player.heroState.inspiration<3:request.type==='numberChoice'?(request.choices.some(c=>c.value==='inspiration')?'inspiration':Number(player.count<player.limit)):undefined,
  sinkingConcerto({request,game,id},{cardCost}){if(request.type!=='cardChoice')return undefined;const sets=request.validSets??[];const best=[...sets].sort((a,b)=>cardCost(game,id,a.map(i=>game.player(id).hand[i]))-cardCost(game,id,b.map(i=>game.player(id).hand[i])))[0];return best??null;},
  passionateRhapsody:({request,player})=>request.type==='skillChoice'?true:request.type==='numberChoice'?(player.count>=5?'discard':'damage'):undefined,
  victorySymphony:({request,player})=>request.type==='skillChoice'?true:player.energy.gem===0&&request.choices.some(c=>c.value==='crystal')?'crystal':'gain',
 }
};
