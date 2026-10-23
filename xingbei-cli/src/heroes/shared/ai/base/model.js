import { aiFor, heroPolicies, healingCap } from './registry.js';
import { sealEffectValue, exposeSeals, isBinding, sealsCard } from '../../../sealer/ai.js';
import {createDeck} from '../../../../cards.js';
const publicDeck=createDeck(),magicRate=publicDeck.filter(c=>c.name==='magicBullet').length/publicDeck.length;
import {terminalForecast} from './horizon.js';
// Pure approximate evaluator over a detached public observation. Never a Game.
// Units are heuristic team utility, NOT damage or a calibrated win probability.
export const weights = Object.freeze({ morale: 30, cup: 48, stone: 5, healing: 2.5, unknown: 2.6 });
import {costBeliefs} from './beliefs.js';
// History/beliefs are immutable for a decision. Cloning them at every simulated
// branch made long-history wind sequences unusably slow without adding evidence.
// Traits are immutable within one detached observation. Copy branch-mutable
// records explicitly instead of repeatedly serializing six-seat trait tables.
const freezeTree=x=>{if(x&&typeof x==='object'){for(const v of Object.values(x))freezeTree(v);Object.freeze(x);}return x;};
const immutableTraits=c=>freezeTree(structuredClone(c.traits));
const copyCard=c=>c?{...c,elements:[...c.elements],uniqueSkills:[...c.uniqueSkills]}:c;
// Detached turn data contains only plain scalar/array/object records. Recursing
// over those few fields avoids structuredClone's transfer machinery per leaf.
const copyTurn=x=>Array.isArray(x)?x.map(copyTurn):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,copyTurn(v)])):x;
export const clone=s=>({...s,turn:copyTurn(s.turn),
 players:s.players.map(p=>({...p,energy:{...p.energy},hand:p.hand.map(copyCard),known:p.known.map(copyCard),effects:p.effects.map(e=>({...e,card:copyCard(e.card)}))})),
 teams:Object.fromEntries(Object.entries(s.teams).map(([id,t])=>[id,{...t}]))});
export const traits = (c, id) => c?.traits?.[id]?.elements ?? c?.elements ?? [];
export const cardData = c => ({id:c.id,name:c.name,type:c.type,elements:[...c.elements],uniqueSkills:[...c.uniqueSkills],traits:immutableTraits(c)});
export function stateOf(g, id, { economy = true, ownership = true, energy = true, healing = true } = {}) {
 return { observer: id, economy, ownership, energy, healing, current: g.current, turn: structuredClone(g.turn.state),
  players: g.players.map(p => ({ id:p.id,team:p.team,hero:p.hero.skills.length?p.hero.id:'none',limit:p.handLimit,
   skillIds:Object.freeze(p.getSkills().map(({skill})=>typeof skill==='string'?skill:skill.id)),
   count:p.hand.length,hand:p.id===id?p.hand.map(c=>({id:c.id,name:c.name,type:c.type,elements:[...c.elements],uniqueSkills:[...c.uniqueSkills],traits:immutableTraits(c)})):[],
   known:[],healing:p.healing,healingLimit:g.getHealingLimit(p.id),energy:{...p.energy},
   effects:p.statuses.map(c=>({id:c.id,name:c.attachment.effectId,card:{id:c.id,name:c.name,type:c.type,elements:[...c.elements],uniqueSkills:[...c.uniqueSkills],traits:immutableTraits(c)}})) })),
  teams:Object.fromEntries(Object.entries(g.teams).map(([t,v])=>[t,{morale:v.morale,cups:v.cups,...g.stoneCounts(t)}])),
  actions:Object.freeze(structuredClone(g.publicHistory?.actions??[])),
  history:Object.freeze(structuredClone(g.publicHistory?.events??[]).map(e=>{if(e.elements)Object.freeze(e.elements);return Object.freeze(e);})),
  beliefs:Object.freeze(Object.fromEntries([...costBeliefs(g)].map(([id,gaps])=>[id,Object.freeze(gaps)]))) };
}
export function burden(n, limit=6) { const x=Math.max(0,n-(limit-3));return 1.3*x*x; }
export function handValue(s,p) {
 if(!s.economy)return p.count*weights.unknown;
 if(p.id!==s.observer) return p.count*weights.unknown-burden(p.count,p.limit);
 const cards=p.hand, attacks=cards.filter(c=>c.type==='attack'), spells=cards.filter(c=>c.type==='spell');
 let value=Math.max(0,p.count-cards.length)*weights.unknown+cards.length*.5;
 const groups=new Map();for(const c of attacks)for(const e of traits(c,p.id))groups.set(e,(groups.get(e)??0)+1);
 const urgency=1+Math.max(0,7-s.teams[p.team].morale)/7;
 for(const [e,count] of groups)value+=(e==='dark'?12*urgency:1.5)+Math.min(2,count-1)*.8;
 const lights=cards.filter(c=>c.name==='holyLight').length;
 if(lights)value+=12*urgency+Math.min(2,lights-1)*2;
 // Offensive spell options are realized by the planner, not paid twice as retention.


 value+=aiFor(p).handBonus?.(p,{cards,attacks,groups})??0;
 // Specialties are options, not unconditional large retention bonuses.
 if(s.ownership)value+=specialtyOptionValue(s,p);
 else for(const skill of heroPolicies.flatMap(policy=>policy.optionSkills??[]))if(cards.some(c=>c.uniqueSkills.includes(skill)))value+=2;
 return value-burden(p.count,p.limit);
}
export function specialtyOptionValue(s,p) {
 return heroPolicies.reduce((sum,policy)=>sum+(policy.specialtyOptionValue?.(s,p)??0),0);
}
// Enumerate evidenced uses, with decreasing readiness for subsequent turns.
// Crystal-cost skills accept either resource; gem-only skills never use crystals.
export function energyUses(s,p) {
 const known=p.id===s.observer?p.hand:p.known;
 const attacks=p.id===s.observer?known.filter(c=>c.type==='attack').length:p.count*.6;
 const enemies=s.players.filter(t=>t.team!==p.team);
 return aiFor(p).energyUses?.(s,p,{known,attacks,enemies})??[];
}

export function energyPlan(s,p) {
 if(!p.energy.gem&&!p.energy.crystal)return 0;
 // Stored shelter energy remains usable after a free heal. Protection is valued
 // against the same residual loss below, never as an asset that healing destroys.
 const custom=aiFor(p).energyValue?.(s,p,weights);if(custom!==undefined)return custom;
 let gem=p.energy.gem,crystal=p.energy.crystal,result=0,uses=0;
 for(const use of energyUses(s,p)) {
  if(use.kind==='gem'){if(!gem)continue;gem--;}
  else if(crystal)crystal--;else if(gem)gem--;else continue;
  result+=use.value;uses++;
 }
 // Two realizable charges amortize one future refine action (one stone unit).
 return result+Math.max(0,uses-1)*weights.stone;
}
// Shared stones retain the best unfilled team use as opportunity cost. A gem
// needed by a gem-only ally has no equivalent crystal substitute.
export function allocationValue(s,team) {
 if(!s.teams[team].gem&&!s.teams[team].crystal)return 0;
 const needs=s.players.filter(p=>p.team===team).flatMap(p=>{
  let gem=p.energy.gem,crystal=p.energy.crystal;
  const unmet=energyUses(s,p).filter(use=>{if(use.kind==='gem'&&gem){gem--;return false;}if(use.kind==='either'&&(gem||crystal)){if(crystal)crystal--;else gem--;return false;}return true;});
  // Crystals held by a gem-only role cannot be spent to free capacity.
  return aiFor(p).energySlots?.(p,unmet)??unmet;
 });
 const {gem,crystal}=s.teams[team];
 // Exact assignment for the two permitted use classes. Enumerate the number of
 // gem-only slots; all remaining flexible slots accept either remaining stone.
 // Equivalent to the small 2-D DP, without allocating a table for every leaf.
 const prefix=kind=>{const values=needs.filter(u=>u.kind===kind).map(u=>u.value*.8-weights.stone).filter(v=>v>0).sort((a,b)=>b-a),out=[0];for(const v of values)out.push(out.at(-1)+v);return out;};
 const only=prefix('gem'),either=prefix('either');let best=0;
 for(let g=0;g<=Math.min(gem,only.length-1);g++)best=Math.max(best,only[g]+either[Math.min(gem+crystal-g,either.length-1)]);
 return best;
}
export function nextTurnRisk(s,playerId=s.observer) {
 const p=s.players[playerId];let risk=0,pressure=0,defenses=p.hand.filter(c=>['darkStrike','holyLight'].includes(c.name)).length;
 const coverage=new Set(p.hand.filter(c=>c.type==='attack').flatMap(c=>traits(c,p.id)));
 const aim=1/Math.max(1,s.players.filter(x=>x.team===p.team).length),shield=p.effects.some(e=>e.name==='holyShield')?.4:0;
 // Residual value to our next effective action. Public seats and resources only.
 // This is a threat estimate, not a simulation with actual hidden cards.
 for(let step=1;step<=s.players.length;step++) {
  const t=s.players[(s.current+step)%s.players.length];if(t.id===p.id)break;
  if(t.team===p.team) {
   pressure=Math.max(0,pressure-(aiFor(t).riskRelief?.(t)??0));
   continue;
  }
  if(!t.count)continue;
  const activity=Math.min(.8,.2+t.count*.1);
  let block=p.id!==s.observer?1-.75**p.count:defenses>0?.75:Math.min(.5,coverage.size*.09);
  if(defenses>0)defenses-=activity*aim;
  const force=aiFor(t).riskForce?.(t)??0;
  block*=1-force;
  const amount=aiFor(t).riskDamage?.(t)??2;
  pressure+=activity*aim*(1-block)*(1-shield)*amount;
  const overflow=Math.max(0,p.count+pressure-healingCap(p,pressure)-p.limit);
  risk=Math.max(risk,overflow*weights.morale);
 }
 // Delay caused by public weakness is a lost opportunity, not free waiting.
 if(p.effects.some(e=>e.name==='weakness'||isBinding(e)))risk+=pressure*2;
 if(risk/weights.morale>=s.teams[p.team].morale)risk+=200;
 return risk?-risk:0;
}
export function effectValue(s,p,e) {
 if(e.name==='holyShield')return 3+Math.max(0,p.count-3)*2;
 if(e.name==='poison')return -2-Math.max(0,p.count-4)*5;
 if(e.name==='weakness'||isBinding(e))return -5-Math.max(0,p.count-3)*2;
 const sealed=sealEffectValue(s,p,e);if(sealed!==undefined)return sealed;
 return 0;
}
const spellCache=new WeakMap();
export function spellExposure(s,team) {
 const allies=s.players.filter(p=>p.team===team),enemies=s.players.filter(p=>p.team!==team);
 // Bounded distribution over at most three public enemy opportunities. Apply
 // shelter inside each loss outcome; subtracting it after expectation erases
 // low-probability losses that exceed the available energy.
 const exposures=allies.map(target=>target.effects.some(e=>e.name==='holyShield')?0:Math.max(0,target.count+2-healingCap(target,2)-target.limit));
 const width=Math.max(0,...exposures);
 if(!width)return 0;
 const shelter=allies.filter(p=>aiFor(p).protectsSpellOverflow).reduce((n,p)=>n+p.energy.gem+p.energy.crystal,0);
 if(shelter>=width*enemies.length)return 0;
 // Only these sufficient statistics enter the finite distribution. Keep the
 // bounded memo local to this detached decision's immutable beliefs object.
 const key=JSON.stringify([exposures,enemies.map(p=>p.count),shelter]);
 let memo=spellCache.get(s.beliefs);if(!memo){memo=new Map();spellCache.set(s.beliefs,memo);}
 if(memo.has(key))return memo.get(key);
 let distribution=[1];
 for(const enemy of enemies){
  const chance=1-(1-magicRate)**enemy.count,next=Array(distribution.length+width).fill(0);
  for(let loss=0;loss<distribution.length;loss++){
   next[loss]+=distribution[loss]*(1-chance);
   for(const excess of exposures)next[loss+excess]+=distribution[loss]*chance/Math.max(1,allies.length);
  }
  distribution=next;
 }
 const result=distribution.reduce((n,p,loss)=>n+p*Math.max(0,loss-shelter),0)*weights.morale;
 if(memo.size<4096)memo.set(key,result);
 return result;
}
export function components(s) {
 const team=s.players[s.observer].team, out={morale:0,cups:0,stones:0,allocation:0,conversion:0,ownHand:0,otherHands:0,healing:0,energy:0,effects:0,nextTurnRisk:s.economy?nextTurnRisk(s):0,otherTurnRisk:0,spellRisk:-spellExposure(s,team)+spellExposure(s,team==='red'?'blue':'red'),futureTerminal:terminalForecast(s),cupWindow:0,terminal:0};
 for(const [id,t] of Object.entries(s.teams)) {
  const sign=id===team?1:-1;
  out.morale+=sign*(t.morale*weights.morale-3*Math.max(0,5-t.morale)**2);
  out.allocation+=sign*allocationValue(s,id);
  out.cups+=sign*t.cups*weights.cup;out.stones+=sign*(t.gem+t.crystal)*weights.stone;
  // Discounted next-turn synthesis option; paid out of the same potential when
  // stones are consumed. No unconditional reward for acquiring/using resources.
  const readiness=Math.max(...s.players.filter(p=>p.team===id).map(p=>p.count<=3?.8:p.count===4?.4:.15));
  out.conversion+=sign*readiness*(Math.min(3,t.gem+t.crystal)/3)**2*18;
  // Uncertain hidden-card branches are bounded; observed/certain outcomes retain priority.
  const terminalScale=s.uncertain?weights.morale*5:100000;
  if(t.morale<=0)out.terminal-=sign*terminalScale;if(t.cups>=5)out.terminal+=sign*terminalScale;
  if(t.cups===4&&t.gem+t.crystal>=3) {
   const windows=s.players.filter(p=>p.team===id).map(p=>{
    const distance=((p.id-s.current+s.players.length)%s.players.length)||s.players.length;
    const skipped=p.effects.some(e=>e.name==='weakness'||isBinding(e));
    // Public ability to shed cards can open a later window, never an assumed hidden card.
    const preparation=aiFor(p).cupPreparation?.(p)??0;
    return (p.count<=3?1:preparation)/(1+distance*.25)*(skipped?.25:1);
   });
   out.cupWindow+=sign*weights.morale*5*Math.max(...windows);
  }
 }
 for(const p of s.players) {
  const sign=p.team===team?1:-1;
  if(s.economy&&p.id!==s.observer)out.otherTurnRisk+=sign*nextTurnRisk(s,p.id)*.5;
  out[p.id===s.observer?'ownHand':'otherHands']+=sign*handValue(s,p);
  out.healing+=sign*p.healing*weights.healing;out.energy+=sign*energyPlan(s,p);
  out.effects+=sign*p.effects.reduce((sum,e)=>sum+effectValue(s,p,e),0);
  // A gifted card is known to its donor. Use public role/status/history only;
  // do not invent knowledge of recipient duplicates or an empty private hand.
  for(const c of p.known) {
   const useful=aiFor(p).giftValue?.(s,p,c)??0;
   const seal=sealsCard(p,c);
   const gap=s.history.filter(e=>e.type==='unanswered'&&s.players[e.playerId]?.team!==p.team&&e.elements?.some(x=>traits(c,p.id).includes(x))).slice(-3).reduce((v,e)=>v+.2*Math.min(2,e.acceptCost??0),0);
   out.otherHands+=sign*(useful+gap-(seal?3:0));
  }
 }
 return out;
}
export const value=s=>Object.values(components(s)).reduce((a,b)=>a+b,0);
export function difference(before,after) {const a=components(before),b=components(after);return Object.fromEntries(Object.keys(a).map(k=>[k,b[k]-a[k]]));}
export function remove(s,id,cards) {
 const p=s.players[id],ids=new Set(cards.map(c=>c.id));p.hand=p.hand.filter(c=>!ids.has(c.id));p.known=p.known.filter(c=>!ids.has(c.id));p.count=Math.max(0,p.count-cards.length);
}
export function overflow(s,id,{spell=false}={}) {
 const p=s.players[id],excess=Math.max(0,p.count-p.limit);if(!excess)return;
 let loss=excess;
 if(spell)for(const angel of s.players.filter(t=>t.team===p.team&&aiFor(t).protectsSpellOverflow)) {
  const protection=Math.min(loss,angel.energy.gem+angel.energy.crystal);payEnergy(s,angel.id,protection);loss-=protection;
 }
 s.teams[p.team].morale-=loss;p.count-=excess;
 while(p.hand.length>p.count) {
  const ranked=p.hand.map(c=>{const t=clone(s);remove(t,id,[c]);return {c,v:handValue(t,t.players[id])};}).sort((a,b)=>b.v-a.v);
  p.hand=p.hand.filter(c=>c.id!==ranked[0].c.id);
 }
}
export function draw(s,id,n,options) {s.players[id].count+=Math.max(0,n);overflow(s,id,options);}
export function heal(s,id,n) {const p=s.players[id];p.healing+=n>0?Math.max(0,Math.min(n,p.healingLimit-p.healing)):-Math.min(-n,p.healing);}
export function payEnergy(s,id,n=1,kind='crystal') {
 const e=s.players[id].energy;if(kind==='gem'){e.gem-=n;return;}
 const crystals=Math.min(e.crystal,n);e.crystal-=crystals;e.gem-=n-crystals;
}
export function stones(s,team,kind,n) {const t=s.teams[team];t[kind]+=n>0?Math.min(n,Math.max(0,5-t.gem-t.crystal)):n;}
// This is a public, feasible defense option, not knowledge of hidden cards.
// Share it with the actual healing decision so own and predicted defense agree.
export function synthesisHealing(s,id,n) {
 const p=s.players[id],t=s.teams[p.team],cap=Math.min(n,healingCap(p,n));
 const needed=Math.max(0,p.count+n-3);
 return s.healing&&t.cups===4&&t.gem+t.crystal>=3&&needed>0&&needed<=cap?needed:null;
}
export function damage(s,id,n,damageType='spell') {
 const p=s.players[id];
 // Unknown opponents use public overflow-prevention healing; own player compares
 // all legal healing expenditures on the same utility scale.
 const cap=Math.min(n,healingCap(p,n));
 let spend=Math.min(cap,Math.max(0,p.count+n-p.limit));
 const preserve=synthesisHealing(s,id,n);
 if(preserve!==null)spend=Math.max(spend,preserve);
 else if(id===s.observer) {
  let best=-Infinity;for(let h=0;h<=cap;h++){const t=clone(s);t.players[id].healing-=h;draw(t,id,n-h,{spell:damageType==='spell'});const v=value(t);if(v>best){best=v;spend=h;}}
 }
 p.healing-=spend;draw(s,id,n-spend,{spell:damageType==='spell'});
}
export function expose(s,id,cards) { exposeSeals(s,id,cards); }
export function spend(s,id,cards,{publicExposure=true}={}) {remove(s,id,cards);if(publicExposure)expose(s,id,cards);}
export function transfer(s,id,targetId,c) {
 remove(s,id,[c]);const t=s.players[targetId];t.count++;
 if(targetId===s.observer)t.hand.push(c);else t.known.push(c);
}
