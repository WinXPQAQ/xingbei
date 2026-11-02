import {damageTarget,usefulExtra} from '../shared/ai/decisions.js';
export const swordEmperorAi={
  id:'swordEmperor',acceptsRefine:()=>true,
  cardBonus:({card,same})=>card.type==='attack'?(same?4:10):-4,
  resourceValue:p=>(p.heroState.swordQi??0)*3+p.coveredCount*3+p.energy.crystal*2,
  attackMissBonus:({player,active})=>active?Math.max(0,5-(player.heroState.swordQi??0))*.5+(player.coveredCount<3?3:0):0,
  attackHitBonus:({state,id,active,player},api)=>active&&player.heroState.swordQi?Math.max(0,...state.players.filter(p=>p.team!==player.team).map(p=>api.damageGain(state,id,p.id,Math.min(3,player.heroState.swordQi))-3)):0,
  decisions:{
    angelSoul:({request,player,state})=>player.healing<player.healingLimit||state.teams[player.team].morale<15?request.choices.find(c=>c.value!=null)?.value:null,
    demonSoul:({request})=>request.choices.find(c=>c.value!=null)?.value??null,
    unyielding:(a,api)=>usefulExtra(a,api,1,8),
    swordQiSlash(a,api){
      if(a.request.type==='playerChoice')return damageTarget(a,api,a.context.amount??1);
      let best={n:0,score:0};
      for(const c of a.request.choices)if(c.value>0){const score=Math.max(...a.state.players.filter(p=>p.id!==a.context.targetId).map(p=>api.damageGain(a.state,a.id,p.id,c.value)))-c.value*2;
        if(score>best.score)best={n:c.value,score};}
      return best.n;
    },
  },
};
