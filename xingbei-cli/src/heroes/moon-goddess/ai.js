import { damageTarget } from '../shared/ai/decisions.js';
export const moonGoddessAi={
 id:'moonGoddess',
  energyPreference: "mixed",
 cardBonus:({card,same})=>card.type==='attack'&&!same?4:0,
 // Dark moons delay a morale payment; keeping them is not a free resource.
 resourceValue:p=>(p.heroState.newMoon??0)*3+(p.heroState.petrification??0)*5+p.energy.gem*3-(p.coveredCount??0)*20,
 refineBonus:({player,gem})=>gem&&!player.energy.gem?5:0,
 uncounterable:({player,active})=>active&&player.heroState.nextUncounterable,
 scoreSkill({game,next,id,player,skillId,action,targetId},api){
  if(skillId!=='paleMoon')return null;
  if(action.mode==='turn'){player.heroState.petrification=0;player.heroState.nextUncounterable=true;return api.bestAttackScore(game,id,next).score+8;}
  const n=Number(action.mode.split(':')[1]);player.heroState.newMoon-=n;player.heroState.petrification=Math.min(3,player.heroState.petrification+1);api.discardEstimate(next,id,1);api.hurt(next,targetId,n+1);return 0;
 },
 decisions:{
  newMoonShelter:({context})=>context.amount<0,
  medusaEye:({request,state,player})=>request.type==='cardChoice'?undefined:state.teams[player.team].morale>6&&player.heroState.petrification===2&&player.energy.gem>0?request.choices.find(c=>c.value!=null)?.value??null:null,
  medusaDamage:(a,api)=>damageTarget(a,api,1),
  moonCycle({request,game,id,state,player,source},api){
   if(request.type==='effectChoice')return request.choices.find(c=>game.cards.get(c.value)?.type==='attack')?.value??request.defaultValue;
   if(request.type==='playerChoice'){
    return [...request.choices].map(c=>{const next=api.copy(state);api.heal(next,c.value,1);return {...c,score:api.evaluate(next)+(next.players[c.value].team===player.team?0.1:0)};}).sort((a,b)=>b.score-a.score)[0]?.value??request.defaultValue;
   }
   const moons=source.covered.filter(c=>c.location.pile==='darkMoon');
   const canGrow=player.healing>0&&player.heroState.newMoon<2;
   if(moons.length&&state.teams[player.team].morale>moons.length){
    // Spell moons still have Medusa's discard/damage use. With a charged gem,
    // turning spare healing into new moon can prepare the spell route first.
    if(canGrow&&player.energy.gem>0&&moons.every(c=>c.type==='spell'))return 'healing';
    return 'moon';
   }
   return canGrow?'healing':'skip';
  },
  moonDesecration(a,api){if(a.request.type==='playerChoice')return damageTarget(a,api,1);return a.state.players.some(p=>p.team!==a.player.team&&api.damageGain(a.state,a.id,p.id,1)>3);},
  darkMoonSlash({request,state,id,context,player},api){
   const baseline=api.copy(state);api.hurt(baseline,context.targetId,context.amount,'attack');
   let best={value:0,score:api.evaluate(baseline)};
   if(state.teams[player.team].morale<=1)return 0;
   for(const c of request.choices)if(c.value){
    const next=api.copy(state),p=next.players[id];api.payEnergy(next,id,1,'crystal');
    next.teams[p.team].morale--;p.coveredCount-=c.value;if(!p.coveredCount)p.heroState.form=null;
    api.hurt(next,context.targetId,context.amount+c.value,'attack');
    const score=api.evaluate(next);if(score>best.score)best={value:c.value,score};
   }
   return best.value;
  },
 },
};
