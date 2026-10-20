// Common public one-round terminal forecast, used at every evaluated state.
// No sampled private hands or deck order. The finite DP tracks both morale
// totals and stops at the first win, so survival and counter-win share units.
import {createDeck} from '../../cards.js';
const cards=createDeck(),attackRate=cards.filter(c=>c.type==='attack').length/cards.length;
const cache=new WeakMap();
export function terminalForecast(s) {
 if(Object.values(s.teams).some(t=>t.morale<=0||t.cups>=5))return 0;
 if(Object.values(s.teams).every(t=>t.morale>6))return 0;
 const key=JSON.stringify([s.current,s.observer,Object.values(s.teams).map(t=>t.morale),s.players.map(p=>[p.count,p.limit,p.healing,p.energy.gem,p.hero,p.effects.some(e=>e.name==='holyShield'),p.hand.length,p.hand.filter(c=>c.type==='attack').length,p.hand.some(c=>c.name==='holyLight'||c.name==='darkStrike')])]);
 let memo=cache.get(s.beliefs);if(!memo){memo=new Map();cache.set(s.beliefs,memo);}if(memo.has(key))return memo.get(key);
 const team=s.players[s.observer].team,other=team==='red'?'blue':'red';
 let win=0,loss=0;
 const alive={};for(const side of [team,other]){alive[side]=Array(s.teams[side].morale+1).fill(0);alive[side][s.teams[side].morale]=1;}
 const counts=s.players.map(p=>p.count);
 for(let step=1;step<=s.players.length;step++) {
  const actor=s.players[(s.current+step)%s.players.length];
  const attacks=actor.hand.filter(c=>c.type==='attack');
  const unknown=Math.max(0,counts[actor.id]-actor.hand.length);
  const active=actor.id===s.observer?(attacks.length?1:1-(1-attackRate)**unknown):1-(1-attackRate)**counts[actor.id];
  counts[actor.id]=Math.max(0,counts[actor.id]-active);
  const targets=s.players.filter(p=>p.team!==actor.team),outcomes=new Map([[0,1-active]]);
  const past=(s.actions??[]).filter(e=>e.type==='attack'&&e.actorId===actor.id).slice(-6);
  const aims=targets.map(t=>1+past.filter(e=>e.targetId===t.id).length),aimTotal=aims.reduce((a,b)=>a+b,0);
  for(const target of targets) {
   const damage=actor.hero==='berserker'?3+Number(counts[actor.id]>3)+2*Number(actor.energy.gem>0):2;
   const healing=Math.min(damage,target.healing,target.hero==='priest'?1:damage);
   const overflow=Math.ceil(Math.max(0,counts[target.id]+damage-healing-target.limit));
   const shield=target.effects.some(e=>e.name==='holyShield');
   const block=target.id===s.observer?(target.hand.some(c=>c.name==='holyLight'||c.name==='darkStrike')?.8:1-.75**Math.max(0,counts[target.id]-target.hand.length)):1-.75**counts[target.id];
   const hit=shield?0:1-block;
   const probability=active*aims[targets.indexOf(target)]/aimTotal;
   outcomes.set(overflow,(outcomes.get(overflow)??0)+probability*hit);
   outcomes.set(0,(outcomes.get(0)??0)+probability*(1-hit));
  }
  // Independent fixed public hazard distributions factor into two marginals;
  // absorb first loss at each seat before considering later comeback chances.
  const victim=actor.team===team?other:team,opponent=actor.team,next=Array(alive[victim].length).fill(0);
  let defeated=0;
  for(let morale=1;morale<alive[victim].length;morale++)if(alive[victim][morale])for(const [damage,chance]of outcomes){
   const p=alive[victim][morale]*chance;if(morale<=damage)defeated+=p;else next[morale-damage]+=p;
  }
  const otherAlive=alive[opponent].reduce((a,b)=>a+b,0);
  if(victim===team)loss+=defeated*otherAlive;else win+=defeated*otherAlive;
  alive[victim]=next;
 }
 const result=(win-loss)*150;if(memo.size<4096)memo.set(key,result);return result;
}
