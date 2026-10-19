import * as baseline from '../v1.0/index.js';
import { aiHeroId, elementsOf, predictedMoraleLoss, cardScore } from '../v1.0/evaluation.js';
import { isolatePolicy } from '../observation.js';

// Confidence, not a label of actual possession. A cheap accepted hit provides
// little evidence; public overflow risk strengthens it. Hidden cards never label it.
export function costBeliefs(game) {
 const result=new Map();
 for(const e of game.publicHistory?.events ?? []) {
  if(e.type==='turn') {for(const gap of result.values())for(const k of Object.keys(gap))gap[k]*=.92;continue;}
  if(!result.has(e.playerId))result.set(e.playerId,{});
  const gap=result.get(e.playerId),decay=e.type==='gain'?.62:e.type==='leave'?.88:1;
  for(const k of Object.keys(gap))gap[k]*=decay;
  if(e.type==='unanswered') {
   const strength=.08+.27*Math.min(1,(e.acceptCost??0)/2);
   for(const element of e.elements)gap[element]=Math.min(.7,(gap[element]??0)+strength*(1-(gap[element]??0)));
   gap.light=Math.min(.5,(gap.light??0)+strength/3);
  } else if(e.type==='leave'&&e.elements)for(const element of e.elements)gap[element]=Math.min(.7,(gap[element]??0)+.10);
 }
 return result;
}
// Reuse the fixed public prior; apply the same bounded missing-response model
// with cost-weighted history, independently of the frozen read-1 history model.
import { createDeck } from '../../cards.js';
const deck=createDeck(),light=deck.filter(c=>c.name==='holyLight').length/deck.length;
function probability(g,id,card,target,gaps,count) {
 const actor=g.player(id),hero=aiHeroId(actor),shield=target.getStatus('holyShield').length>0;
 if(hero==='windSwordmaster'&&count===2)return 1;
 if(hero==='berserker'&&card.hasUniqueSkill('bloodyRoar')&&target.healing===2)return 1;
 if(hero==='marksman'&&card.hasUniqueSkill('precisionShot')&&(shield||target.hand.length>=4))return 1;
 const storm=hero==='windSwordmaster'&&card.hasUniqueSkill('stormArt')&&shield;
 if(shield&&!storm)return 0;
 const elements=elementsOf(g,id,card),gap=gaps.get(target.id)??{},missing=Math.min(...elements.map(e=>gap[e]??0));
 const counter=card.name!=='darkStrike'&&!storm&&!(hero==='marksman'&&elements.includes('thunder'));
 const rate=counter?deck.filter(c=>c.type==='attack'&&(c.name==='darkStrike'||c.elements.some(e=>elements.includes(e)))).length/deck.length*(1-missing):0;
 return (1-Math.min(.95,rate+light*(1-(gap.light??0))))**target.hand.length;
}
function hitValue(g,id,card,target,count,gaps,handCount) {
 const actor=g.player(id),hero=aiHeroId(actor),p=probability(g,id,card,target,gaps,count);
 let damage=hero==='berserker'?3+Number(handCount>4):2,energyCost=0;
 if(hero==='berserker'&&card.hasUniqueSkill('bloodBlade'))damage+=target.hand.length===2?2:target.hand.length===3?1:0;
 if(hero==='berserker'&&actor.energy.gem&&predictedMoraleLoss(target,damage+2)>predictedMoraleLoss(target,damage)){damage+=2;energyCost=12;}
 if(hero==='marksman'&&card.hasUniqueSkill('precisionShot')&&(target.getStatus('holyShield').length||target.hand.length>=4))damage--;
 const loss=predictedMoraleLoss(target,damage);
 let value=p*(35+28*loss-energyCost);
 // Baseline piercing decision requires actual overflow benefit and consumes one
 // spell. Counter-response may reduce hand by one: use that conservative count.
 if(hero==='marksman') {
  const after={...target,hand:{length:Math.max(0,target.hand.length-1)}},spells=actor.hand.filter(c=>c.type==='spell');
  if(spells.length&&predictedMoraleLoss(after,2)>0)value+=(1-p)*Math.max(0,28*predictedMoraleLoss(after,2)-Math.min(...spells.map(c=>cardScore(g,id,c)))*.15);
 }
 return {p,damage,value,loss};
}
// Bounded same-target sequence: legal own cards, actual pending restrictions,
// once-per-turn extras and energy. Expected public hand growth is approximate;
// no future draws, hidden cards, opponent search, or invented extra actions.
export function attackUtility(g,id,first,targetId) {
 const actor=g.player(id),target=g.player(targetId),hero=aiHeroId(actor),gaps=costBeliefs(g),turn=g.turn.state;
 const skills=new Set(actor.getSkills().map(({skill})=>typeof skill==='string'?skill:skill.id));
 const start=turn?.attackCount??0;
 const pending=(turn?.pendingActions??[]).map(a=>a.element??null);
 if(turn?.completed&&pending.length)pending.splice(Math.max(0,pending.findLastIndex(e=>e!=null)),1);
 function visit(card,hand,count,queue,windUsed,shadowUsed,energy,t) {
  const hit=hitValue(g,id,card,t,count,gaps,hero==='berserker'?actor.hand.length:hand.length+1);
  const immediate=hit.value-cardScore(g,id,card,hand)*.12;
  if(hero!=='windSwordmaster'||count>=2)return {value:immediate,steps:[card.id]};
  const after={...t,hand:{length:Math.min(t.handLimit,t.hand.length+hit.p*Math.max(0,hit.damage-Math.min(t.healing,hit.damage)))},healing:Math.max(0,t.healing-hit.p*Math.min(t.healing,hit.damage))};
  const extras=[];
  if(skills.has('galeArt')&&card.hasUniqueSkill('galeArt'))extras.push('galeArt');
  if(skills.has('windFury')&&!windUsed&&hand.some(c=>elementsOf(g,id,c).includes('wind')))extras.push('windFury');
  if(skills.has('swordShadow')&&!shadowUsed&&energy>0)extras.push('swordShadow');
  let best={value:immediate,steps:[card.id]};
  for(let mask=0;mask<(1<<extras.length);mask++) {
   const selected=extras.filter((_,i)=>mask&(1<<i)),q=[...queue,...selected.map(s=>s==='windFury'?'wind':null)];
   if(!q.length)continue;
   const slot=Math.max(0,q.findLastIndex(e=>e!=null)),restriction=q.splice(slot,1)[0];
   for(const next of hand) {
    if(restriction&&!elementsOf(g,id,next).includes(restriction))continue;
    const cost=Number(selected.includes('swordShadow'));
    const future=visit(next,hand.filter(c=>c!==next),count+1,q,windUsed||selected.includes('windFury'),shadowUsed||cost,energy-cost,after);
    const value=immediate+.75*future.value-12*cost;
    if(value>best.value)best={value,steps:[card.id,...future.steps]};
   }
  }
  return best;
 }
 return visit(first,actor.hand.filter(c=>c!==first&&c.type==='attack'),start,pending,!!turn?.usedSkills.windFury,!!turn?.usedSkills.swordShadow,actor.energy.gem+actor.energy.crystal,target);
}
export function createFusionPolicy() {
 const raw={...baseline,
  rankAiActions(g,id) {
   const actor=g.player(id);
   return baseline.rankAiActions(g,id).map(entry=>{
    if(entry.action.type!=='play'||actor.hand[entry.action.index].type!=='attack')return entry;
    const card=actor.hand[entry.action.index],utility=attackUtility(g,id,card,entry.action.targetId);
    return {...entry,score:utility.value,reason:'expected-hit-and-legal-sequence',explanation:utility};
   }).sort((a,b)=>b.score-a.score);
  },
  chooseAiRuleDecision(r,g) {
   if(g&&['galeArt','windFury','swordShadow'].includes(r.skillId)&&r.type==='skillChoice') {
    const p=g.player(r.playerId),attacks=p.hand.filter(c=>c.type==='attack'&&(r.skillId!=='windFury'||elementsOf(g,p.id,c).includes('wind')));
    if(!attacks.length)return false;
    // Spend only if an available follow-up has positive expected value after cost.
    const cost=r.skillId==='swordShadow'?12:0;
    return attacks.some(c=>g.players.some(t=>t.team!==p.team&&attackUtility(g,p.id,c,t.id).value>cost));
   }
   return baseline.chooseAiRuleDecision(r,g);
  },
 };
 return isolatePolicy(raw);
}
