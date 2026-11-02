import {damageTarget,discardTarget,cheapCards} from '../shared/ai/decisions.js';
export const talismanMasterAi={
  id:'talismanMaster',acceptsRefine:()=>true,
  cardBonus:({card,elements,same})=>elements.includes('thunder')||elements.includes('wind')?(same?6:15):elements.includes('fire')?6:0,
  resourceValue:p=>p.coveredCount*3+p.energy.crystal*2,
  scoreSkill({next,id,player,action,skillId},api){
    if(!['thunderTalisman','windTalisman'].includes(skillId))return null;
    for(const target of action.targetIds)if(skillId==='thunderTalisman')api.hurt(next,target,1);else api.discardEstimate(next,target,1);
    return player.coveredCount<2&&player.count>1?3:0;
  },
  decisions:{
    chant(a,api){const selected=cheapCards(a,api);return a.source.hand.length>1&&selected.length?selected:null;},
    spiritCollapse:({state,id,player},api)=>state.players.filter(p=>p.team!==player.team).some(p=>api.damageGain(state,id,p.id,2)-api.damageGain(state,id,p.id,1)>5),
    hundredGhosts(a,api){if(a.request.type==='playerChoice')return damageTarget(a,api);return a.request.choices.find(c=>c.value!=null)?.value??null;},
    ghostFlames:({state,id,player},api)=>state.players.filter(p=>p.team!==player.team).reduce((n,p)=>n+api.damageGain(state,id,p.id,1),0)>10,
    ghostExclude:({request,state,id},api)=>[...request.choices].sort((a,b)=>api.damageGain(state,id,a.value,1)-api.damageGain(state,id,b.value,1))[0].value,
    windTalisman:cheapCards,
  },sharedDecisionSkills:['windTalisman'],
};
