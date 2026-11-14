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
// AI-only commitment; human legal actions and game rules stay unrestricted.
export function forcedMagicArcherRefine(game, id) {
  const player=game.player(id);
  if (player.hero.id!=='magicArcher' || player.energy.gem+player.energy.crystal!==0 ||
      !game.canRefine(id) || game.getEnergyLimit(id)<2 || game.stoneCounts(player.team).gem<2) return null;
  return {type:'refine',stones:{gem:2,crystal:0}};
}
export function allowsMagicArcherAiAction(game,id,action) {
  const player=game.player(id), type=action?.direction??action?.type;
  return player.hero.id!=='magicArcher' || player.hand.length<2 ||
    player.energy.gem+player.energy.crystal===0 || !['purchase','synthesize'].includes(type);
}

// Undefined means the policy still chooses. Charge is offered before magicEye:
// with a gem it may decline charge, but must then accept magicEye. With only
// crystals charge is the sole activation. Never manufacture an illegal offer.
export function forcedMagicArcherAiChoice(game,id,request) {
  const player=game.player(id);
  if(player.hero.id!=='magicArcher' || request.blockedReason)return undefined;
  if(request.type==='energyChoice' && request.skillId==='charge' && player.energy.crystal>0)
    return request.choices.find(c=>c.value.crystal===1&&c.value.gem===0)?.value;
  if(request.type!=='skillChoice' || game.turn.state?.playerId!==id ||
      game.turn.state?.phase!=='activation' || player.energy.gem+player.energy.crystal===0 ||
      !request.choices?.some(c=>c.value===true))return undefined;
  if(request.skillId==='magicEye' || (request.skillId==='charge'&&player.energy.gem===0))return true;
  return undefined;
}
export const magicArcherAi={
  id:'magicArcher', energyPreference: "mixed",acceptsRefine:()=>true,
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
    charge:({source,player,request})=>request.type==='energyChoice'
      ?[...request.choices].sort((a,b)=>a.value.gem-b.value.gem)[0]?.value
      :source.energy.crystal>0&&player.coveredCount<3,
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
