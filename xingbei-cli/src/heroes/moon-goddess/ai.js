import { damageTarget } from '../shared/ai/decisions.js';
export const moonGoddessAi={
 id:'moonGoddess',
 cardBonus:({card,same})=>card.type==='attack'&&!same?4:0,
 resourceValue:p=>(p.heroState.newMoon??0)*3+(p.heroState.petrification??0)*5+p.energy.gem*3,
 refineBonus:({player,gem})=>gem&&!player.energy.gem?5:0,
 uncounterable:({player,active})=>active&&player.heroState.nextUncounterable,
 scoreSkill({game,next,id,player,skillId,action,targetId},api){
  if(skillId!=='paleMoon')return null;
  if(action.mode==='turn'){player.heroState.petrification=0;player.heroState.nextUncounterable=true;return api.bestAttackScore(game,id,next).score+8;}
  const n=Number(action.mode.split(':')[1]);player.heroState.newMoon-=n;player.heroState.petrification=Math.min(3,player.heroState.petrification+1);api.discardEstimate(next,id,1);api.hurt(next,targetId,n+1);return 0;
 },
 decisions:{
  newMoonShelter:({context})=>context.amount<0,
  medusaEye:({request,state,player})=>state.teams[player.team].morale>6&&player.heroState.petrification===2&&player.energy.gem>0?request.choices.find(c=>c.value!=null)?.value??null:null,
  medusaDamage:(a,api)=>damageTarget(a,api,1),
  moonCycle({request,player}){if(request.type==='effectChoice')return request.defaultValue;if(request.type==='playerChoice')return undefined;return player.healing>0&&player.heroState.newMoon<2?'healing':'skip';},
  moonDesecration(a,api){if(a.request.type==='playerChoice')return damageTarget(a,api,1);return a.state.players.some(p=>p.team!==a.player.team&&api.damageGain(a.state,a.id,p.id,1)>3);},
  darkMoonSlash({request,state,id,context,player},api){let best={value:0,score:0};for(const c of request.choices)if(c.value){const gain=api.damageGain(state,id,context.targetId,context.amount+c.value,'attack')-api.damageGain(state,id,context.targetId,context.amount,'attack')-30-4;if(gain>best.score&&state.teams[player.team].morale>1)best={value:c.value,score:gain};}return best.value;},
 },
};
