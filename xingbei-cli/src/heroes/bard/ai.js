import { damageTarget } from '../shared/ai/decisions.js';
function forbiddenResult(next,bardId,api){
 const bard=next.players[bardId];
 if(bard.heroState.inspiration<3)bard.heroState.inspiration++;
 else{api.hurt(next,bardId,3,'spell',{sourceId:bardId});if(!api.terminal(next))bard.heroState.form='eternalPrisoner';}
}
function songPlan(a,api,skill){
 const {state,id,player,context}=a,bardId=context.sourceId??id,bard=state.players[bardId];
 const candidates=[];
 if(skill==='passionateRhapsody'){
  const discard=api.copy(state);api.discardEstimate(discard,id,2);forbiddenResult(discard,bardId,api);
  candidates.push({mode:'discard',score:api.evaluate(discard)-api.evaluate(state)});
  const foes=state.players.filter(p=>p.team!==bard.team);
  for(let i=0;i<foes.length;i++)for(let j=i+1;j<foes.length;j++){
   const damage=api.copy(state);
   const targets=[foes[i].id,foes[j].id].sort((x,y)=>(x-id+6)%6-(y-id+6)%6);
   for(const target of targets)if(!api.terminal(damage))api.hurt(damage,target,1,'spell',{sourceId:bardId});
   // The second target can trigger the bard's two-card concerto. Its cost and
   // pressure relief depend on the bard's own known hand or public hand count.
   let concerto=0;
   if(!bard.heroState.form&&!bard.heroState.concertoUsed&&bard.count>=2){
    if(bardId===id){const cards=player.hand;const pairs=cards.flatMap((c,i)=>cards.slice(i+1).filter(d=>c.elements.some(e=>d.elements.includes(e))).map(d=>[c,d]));
     concerto=pairs.length?Math.min(5,Math.max(0,bard.count-3)*2):0;
    }else concerto=Math.min(5,Math.max(0,bard.count-3)*1.5);
   }
   if(!api.terminal(damage))forbiddenResult(damage,bardId,api);
   candidates.push({mode:'damage',score:api.evaluate(damage)-api.evaluate(state)+concerto});
  }
 }else{
  const team=state.teams[player.team],room=player.energy.gem+player.energy.crystal<player.energyLimit;
  for(const mode of ['gain',...['gem','crystal'].filter(k=>room&&team[k])]){
   const next=api.copy(state);let readiness=0;
   if(mode==='gain'){api.stones(next,player.team,'gem',1);api.heal(next,id,1);}
   else{next.teams[player.team][mode]--;readiness=api.energyGiftBonus(next,id,{gem:1,crystal:0});next.players[id].energy.gem++;}
   if(bard.heroState.form&&bardId!==id)api.heal(next,bardId,1);
   forbiddenResult(next,bardId,api);
   candidates.push({mode,score:api.evaluate(next)-api.evaluate(state)+readiness});
  }
 }
 return candidates.sort((a,b)=>b.score-a.score)[0];
}
export const bardAi={
 id:'bard',energyPreference:'crystal',
 cardBonus:({same,card,retained,elements})=>{
  const matching=retained.filter(c=>c.elements.some(e=>elements.includes(e))).length;
  return (same&&matching===1?15:same?2:0)+(card.type==='spell'?5:0);
 },
 resourceValue:p=>(p.heroState.inspiration??0)*2,
 refineBonus:({player})=>!player.energy.gem&&!player.energy.crystal?9:player.energy.gem+player.energy.crystal<2?3:0,
 scoreSkill({next,id,targetId,skillId,action,player},api){
  if(skillId!=='dissonance')return null;
  const[k,n]=(action.mode??'draw:2').split(':');player.heroState.inspiration-=Number(n);player.heroState.form=null;
  // Keeping duplicate ids is intentional: choosing oneself resolves both parts.
  for(const who of[id,targetId]){if(api.terminal(next))break;if(k==='draw')api.draw(next,who,Number(n)-1);else api.discardEstimate(next,who,Number(n)-1);}
  return 0;
 },
 sharedDecisionSkills:['passionateRhapsody','victorySymphony'],
 decisions:{
  hopeFugue(a,api){
   const {request,player,state,id,game}=a;
   if(request.type==='skillChoice'){
    if(player.energy.gem+player.energy.crystal<=(request.reservedEnergy??0))return false;
    const next=api.copy(state);api.payEnergy(next,id,1,'crystal');
    const moving=game.cards.get(`eternalMovement-${id}`)?.location.zone==='status';
    if(moving){api.discardEstimate(next,id,1);next.players[id].heroState.inspiration=Math.min(3,player.heroState.inspiration+1);}
    return api.evaluate(next)-api.evaluate(state)+(moving?3:6)>0;
   }
   if(request.type==='numberChoice'){
    if(request.choices.some(c=>c.value==='inspiration'))return player.heroState.inspiration<3?'inspiration':'healing';
    const next=api.copy(state);api.draw(next,id,1);return Number(api.evaluate(next)>api.evaluate(state));
   }
   return undefined;
  },
  sinkingConcerto(a,api){
   if(a.request.type==='playerChoice')return damageTarget(a,api,1);
   if(a.request.type!=='cardChoice')return undefined;
   let best={set:null,score:0};
   for(const set of a.request.validSets??[]){
    const cards=set.map(i=>a.source.hand[i]),next=api.copy(a.state);
    api.spend(next,a.id,cards.map(c=>next.players[a.id].hand.find(x=>x.id===c.id)));
    next.players[a.id].heroState.inspiration=Math.min(3,a.player.heroState.inspiration+1);
    const extra=cards.some(c=>c.type==='spell')?Math.max(0,...next.players.filter(p=>p.team!==a.player.team).map(p=>api.damageGain(next,a.id,p.id,1))):0;
    const score=api.evaluate(next)-api.evaluate(a.state)+extra-api.cardCost(a.game,a.id,cards);
    if(score>best.score)best={set,score};
   }
   return best.set;
  },
  passionateRhapsody(a,api){
   if(a.request.type==='playerChoice')return damageTarget(a,api,1);
   if(!['skillChoice','numberChoice'].includes(a.request.type))return undefined;
   const plan=songPlan(a,api,'passionateRhapsody');return a.request.type==='skillChoice'?plan.score>0:plan.mode;
  },
  victorySymphony(a,api){
   const plan=songPlan(a,api,'victorySymphony');return a.request.type==='skillChoice'?plan.score>0:plan.mode;
  },
 }
};
