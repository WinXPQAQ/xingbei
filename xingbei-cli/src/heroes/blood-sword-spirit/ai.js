import {damageTarget,cheapCards} from '../shared/ai/decisions.js';
import {estimateHeroCapabilities} from '../../ai/hero-capabilities.js';

const gardenActive=(game,state,id)=>state.players[id].heroState.gardenPreview||
 game.cards.get(state.players[id].heroState.gardenCardId)?.location.zone==='field';
function gardenState(game,state,id,kind,api){
 const next=api.copy(state),p=next.players[id];
 api.payEnergy(next,id,1,kind);
 p.heroState.blood=Math.min(kind==='gem'?4:3,(p.heroState.blood??0)+2);
 p.heroState.gardenPreview=true;
 for(const target of next.players)target.healingDisabled=true;
 if(kind==='gem'){
  const indexes=api.chooseAiDiscard(game,id,Math.max(0,p.count-4));
  const discarded=indexes.map(i=>game.player(id).hand[i]?.id);
  api.remove(next,id,p.hand.filter(c=>discarded.includes(c.id)));
 }
 return next;
}
// A small horizon: compare one real remaining attack after paying Flash, with
// or without Barrier. The follow-up attack itself does not recursively plan.
function flashPlan({game,state,id},api){
 const p=state.players[id];
 let best={score:0,barrier:false};
 if(!p.heroState.blood||!p.hand.some(c=>c.type==='attack'))return best;
 for(const barrier of [false,true]){
  if(barrier&&p.heroState.blood<2)continue;
  const base=api.copy(state);base.players[id].heroState.blood-=1+Number(barrier);
  const targets=barrier?base.players.filter(t=>t.team!==p.team).map(t=>t.id):[null];
  for(const targetId of targets){
   const next=api.copy(base);
   if(barrier)api.hurt(next,targetId,1,'spell',{sourceId:id});
   const beforeMorale=next.teams[p.team].morale;
   if(!api.terminal(next))api.hurt(next,id,barrier?1:2,'spell',{sourceId:id});
   const follow=api.terminal(next)?{score:0}:api.bestAttackScore(game,id,next);
   const loss=beforeMorale-next.teams[p.team].morale;
   // One point of overflow can buy a useful extra attack. It is still charged
   // by the evaluator, never excused when it would lose the game.
   const continuation=!api.terminal(next)&&loss===1&&follow.score>0?Math.min(12,follow.score*.35):0;
   const score=api.evaluate(next)-api.evaluate(state)+follow.score+continuation;
   if(score>best.score)best={score,barrier,targetId};
  }
 }
 return best;
}
function roseValue(state,id,targetId,api){
 const next=api.copy(state),p=next.players[id];
 p.heroState.blood-=2;
 next.players[targetId].healing=Math.max(0,next.players[targetId].healing-2);
 let best=next;
 const allies=next.players.filter(t=>t.team===p.team&&t.energy.crystal>0);
 if(allies.length){
  let score=-Infinity;
  for(const ally of allies){const option=api.copy(next);option.players[ally.id].energy.crystal--;option.players[ally.id].energy.gem++;
   const value=api.evaluate(option)+api.energyGiftBonus(next,ally.id,{gem:1});if(value>score){score=value;best=option;}}
 }
 for(let step=0;step<state.players.length&&!api.terminal(best);step++)api.hurt(best,(id+step)%state.players.length,1,'spell',{sourceId:id});
 return best;
}
// Group damage opens public response windows (one-damage rebound, team
// spell followups, prophecy turnover). Hidden ally cards only affect readiness;
// no teammate-specific hand inspection or guaranteed trigger is assumed.
function roseOpportunity(state,id,api){
 if(api.terminal(state))return 0;
 let value=0;
 for(const ally of state.players.filter(p=>p.team===state.players[id].team&&p.id!==id)){
  const capacity=estimateHeroCapabilities(state,ally.id);
  const opportunities=capacity.spellThreats.filter(t=>['oneSpellDamageResponse','teamSpellFollowup','prophecyRevealed'].includes(t.route));
  const best=Math.max(0,...opportunities.map(t=>{
   const pressure=Math.max(0,...t.targets.filter(target=>state.players[target].team!==ally.team)
    .map(target=>api.damageGain(state,ally.id,target,t.amountByTarget?.[target]??t.amount)));
   return t.readiness*Math.min(6,2+pressure*.15);
  }));
  value+=best;
 }
 return value;
}
function gardenOption({game,state,id},api){
 const p=state.players[id],options=[{kind:'skip',score:0}];
 for(const kind of ['crystal','gem']){
  if(kind==='gem'?!p.energy.gem:!p.energy.gem&&!p.energy.crystal)continue;
  const next=gardenState(game,state,id,kind,api);
  let continuation=api.bestAttackScore(game,id,next).score;
  if(next.players[id].heroState.blood>=2)for(const target of next.players){
   const rose=roseValue(next,id,target.id,api);
   continuation=Math.max(continuation,api.evaluate(rose)-api.evaluate(next)+roseOpportunity(rose,id,api));
  }
  const ordinary=api.bestAttackScore(game,id,state).score;
  options.push({kind,state:next,score:api.evaluate(next)-api.evaluate(state)+continuation-ordinary});
 }
 return options.sort((a,b)=>b.score-a.score)[0];
}
export const bloodSwordSpiritAi={
 id:'bloodSwordSpirit',energyPreference:'mixed',acceptsRefine:()=>true,
 cardBonus:({card,same})=>card.type==='attack'?(same?5:10):0,
 resourceValue:p=>(p.heroState.blood??0)*4,
 // Actual hit produces the blood used by the optional Flash continuation.
 beforeAttackHit({player}){player.heroState.blood=Math.max(player.heroState.blood??0,Math.min(3,(player.heroState.blood??0)+1));},
 followAttackScore({game,id,branches,active},api){
  if(!active)return 0;
  return branches.reduce((sum,b)=>sum+b.probability*(api.terminal(b.state)?0:flashPlan({game,state:b.state,id},api).score),0);
 },
 preparations({game,state,id,options},api){
  if(gardenActive(game,state,id))return options;
  const plan=gardenOption({game,state,id},api);
  return plan.kind==='skip'?options:[...options,{state:plan.state,activated:'petalDance'}];
 },
 scoreSkill({state,next,id,player,targetId,skillId,game},api){
  if(skillId!=='bloodRose')return null;
  if(!gardenActive(game,state,id))return -60;
  const rose=roseValue(next,id,targetId,api);
  next.players=rose.players;next.teams=rose.teams;
  return roseOpportunity(next,id,api);
 },
 decisions:{
  scarletFlash:(a,api)=>flashPlan(a,api).score>0,
  bloodBarrier(a,api){
   if(a.request.type==='playerChoice')return damageTarget(a,api);
   const amount=a.context.amount??1,sourceId=a.context.sourceId;
   const take=api.copy(a.state);api.hurt(take,a.id,amount,'spell',{sourceId});
   let best=-Infinity;
   for(const target of a.state.players.filter(p=>p.team!==a.player.team)){
    const next=api.copy(a.state);next.players[a.id].heroState.blood--;
    api.hurt(next,target.id,1,'spell',{sourceId:a.id});
    if(!api.terminal(next))api.hurt(next,a.id,Math.max(0,amount-1),'spell',{sourceId});
    best=Math.max(best,api.evaluate(next)-api.evaluate(take));
   }
   return best>0;
  },
  bloodRoseEnergy({request,state},api){
   return [...request.choices].sort((a,b)=>{
    const gain=id=>{const next=api.copy(state);next.players[id].energy.crystal--;const ready=api.energyGiftBonus(next,id,{gem:1});next.players[id].energy.gem++;return api.evaluate(next)+ready;};
    return gain(b.value)-gain(a.value);
   })[0]?.value??request.defaultValue;
  },
  petalDance(a,api){
   if(a.request.type==='cardChoice')return cheapCards(a,api);
   return gardenOption(a,api).kind;
  },
 },
};
