import {discardTarget,cheapCards} from '../shared/ai/decisions.js';
const chargeValue=c=>c.elements.includes('wind')?12:c.elements.includes('fire')?10:c.elements.includes('thunder')?10:0;
function cover(a,api){
  const reserved=new Set(a.game.turn.state?.reservedCardIds??[]);
  const score=i=>chargeValue(a.source.hand[i])-api.cardScore(a.game,a.id,a.source.hand[i])/12-(reserved.has(a.source.hand[i].id)?1000:0);
  const sets=a.request.validSets??a.request.valid.map(i=>[i]);
  const best=[...sets].sort((a,b)=>b.reduce((n,i)=>n+score(i),0)-a.reduce((n,i)=>n+score(i),0))[0];
  return !best||a.request.optional&&best.reduce((n,i)=>n+score(i),0)<=0?null:best;
}
const coveredCost=({request,game})=>request.choices.filter(c=>c.value!=null).sort((a,b)=>chargeValue(game.cards.get(a.value))-chargeValue(game.cards.get(b.value)))[0]?.value??null;
export const magicArcherAi={
  id:'magicArcher',acceptsRefine:()=>true,
  cardBonus:({elements,same})=>elements.some(e=>['fire','wind','thunder'].includes(e))?(same?6:10):0,
  resourceValue:p=>p.coveredCount*3,
  refineBonus:({player})=>player.coveredCount<2&&player.energy.gem+player.energy.crystal===0?8:0,
  scoreSkill({next,id,player,action,targetId,skillId},api){
    if(skillId==='thunderScatter'){
      const n=Number(action.mode??1);player.coveredCount-=n;
      for(let i=0;i<6;i++){const p=next.players[(id+i)%6];if(p.team!==player.team)api.hurt(next,p.id,p.id===targetId?n:1);}
      return 0;
    }
    if(skillId==='multiShotAttack'){api.stones(next,player.team,'gem',1);api.hurt(next,targetId,1,'attack');return 2;}
    return null;
  },
  attackMissBonus:({source,game,id,state,player,active,targetId},api)=>active&&!player.heroState.charged&&!player.heroState.multiShotUsed&&game.player(id).covered.some(c=>c.elements.includes('fire'))&&state.players[targetId].count<state.players[targetId].limit?Math.max(0,api.damageGain(state,id,targetId,3)-3):0,
  decisions:{
    charge:({source,player})=>source.energy.crystal>0&&player.coveredCount<3,
    // Discard-to-four has already resolved: fill only remaining capacity.
    chargeDraw:({player,request})=>{
      const wanted=Math.min(4,Math.max(0,player.limit-player.count));
      return request.choices.find(c=>c.value===wanted)?.value??request.defaultValue;
    },
    chargeCover:cover,chargeTrim:coveredCost,chargeDiscard:cheapCards,
    magicEye:({player})=>player.coveredCount<5,
    magicEyeMode:({player,request})=>player.count<=2||!request.choices.some(c=>c.value==='discard')?'draw':'discard',
    magicEyeTarget:discardTarget,magicEyeDiscard:cheapCards,
    magicPierce(a,api){return a.context.targetId!=null&&(api.damageGain(a.state,a.id,a.context.targetId,3)>2||a.player.coveredCount>=5)?coveredCost(a):null;},
    magicPierceBonus(a,api){return a.context.targetId!=null&&api.damageGain(a.state,a.id,a.context.targetId,(a.context.amount??3)+1,'attack')-api.damageGain(a.state,a.id,a.context.targetId,a.context.amount??3,'attack')>3?coveredCost(a):null;},
    thunderScatter:coveredCost,multiShot:coveredCost,
  },sharedDecisionSkills:['magicEyeDiscard'],
};
