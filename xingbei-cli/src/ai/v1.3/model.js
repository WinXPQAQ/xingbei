// Pure approximate evaluator over a detached public observation. Never a Game.
// Units are heuristic team utility, NOT damage or a calibrated win probability.
export const weights = Object.freeze({ morale: 30, cup: 48, stone: 5, healing: 2.5, unknown: 2.6 });
import {costBeliefs} from '../v1.1/fusion.js';
// History/beliefs are immutable for a decision. Cloning them at every simulated
// branch made long-history wind sequences unusably slow without adding evidence.
// Traits are immutable within one detached observation. Copy branch-mutable
// records explicitly instead of repeatedly serializing six-seat trait tables.
const freezeTree=x=>{if(x&&typeof x==='object'){for(const v of Object.values(x))freezeTree(v);Object.freeze(x);}return x;};
const immutableTraits=c=>freezeTree(structuredClone(c.traits));
const copyCard=c=>c?{...c,elements:[...c.elements],uniqueSkills:[...c.uniqueSkills]}:c;
export const clone=s=>({...s,turn:structuredClone(s.turn),
 players:s.players.map(p=>({...p,energy:{...p.energy},hand:p.hand.map(copyCard),known:p.known.map(copyCard),effects:p.effects.map(e=>({...e,card:copyCard(e.card)}))})),
 teams:Object.fromEntries(Object.entries(s.teams).map(([id,t])=>[id,{...t}]))});
export const traits = (c, id) => c?.traits?.[id]?.elements ?? c?.elements ?? [];
export const cardData = c => ({id:c.id,name:c.name,type:c.type,elements:[...c.elements],uniqueSkills:[...c.uniqueSkills],traits:immutableTraits(c)});
export function stateOf(g, id, { economy = true } = {}) {
 return { observer: id, economy, current: g.current, turn: structuredClone(g.turn.state),
  players: g.players.map(p => ({ id:p.id,team:p.team,hero:p.hero.skills.length?p.hero.id:'none',limit:p.handLimit,
   count:p.hand.length,hand:p.id===id?p.hand.map(c=>({id:c.id,name:c.name,type:c.type,elements:[...c.elements],uniqueSkills:[...c.uniqueSkills],traits:immutableTraits(c)})):[],
   known:[],healing:p.healing,healingLimit:g.getHealingLimit(p.id),energy:{...p.energy},
   effects:p.statuses.map(c=>({id:c.id,name:c.attachment.effectId,card:{id:c.id,name:c.name,type:c.type,elements:[...c.elements],uniqueSkills:[...c.uniqueSkills],traits:immutableTraits(c)}})) })),
  teams:Object.fromEntries(Object.entries(g.teams).map(([t,v])=>[t,{morale:v.morale,cups:v.cups,...g.stoneCounts(t)}])),
  history:Object.freeze(structuredClone(g.publicHistory?.events??[]).map(e=>{if(e.elements)Object.freeze(e.elements);return Object.freeze(e);})),
  beliefs:Object.freeze(Object.fromEntries([...costBeliefs(g)].map(([id,gaps])=>[id,Object.freeze(gaps)]))) };
}
export function burden(n, limit=6) { const x=Math.max(0,n-(limit-3));return 1.3*x*x; }
export function handValue(s,p) {
 if(!s.economy)return p.count*weights.unknown;
 if(p.id!==s.observer) return p.count*weights.unknown-burden(p.count,p.limit);
 const cards=p.hand, attacks=cards.filter(c=>c.type==='attack'), spells=cards.filter(c=>c.type==='spell');
 let value=Math.max(0,p.count-cards.length)*weights.unknown+cards.length*1.2;
 const groups=new Map();for(const c of attacks)for(const e of traits(c,p.id))groups.set(e,(groups.get(e)??0)+1);
 const urgency=1+Math.max(0,7-s.teams[p.team].morale)/7;
 for(const [e,count] of groups)value+=(e==='dark'?12*urgency:3.4)+Math.min(2,count-1)*.8;
 const lights=cards.filter(c=>c.name==='holyLight').length;
 if(lights)value+=12*urgency+Math.min(2,lights-1)*2;
 for(const name of new Set(spells.filter(c=>c.name!=='holyLight').map(c=>c.name)))value+=2.5;
 if(['marksman','sealer'].includes(p.hero)&&attacks.length&&spells.length)value+=4;
 if(p.hero==='priest'&&cards.some(c=>traits(c,p.id).includes('water'))&&cards.length>=2)value+=4;
 if(p.hero==='windSwordmaster'&&attacks.length>=2&&(groups.has('wind')||attacks.some(c=>c.uniqueSkills.includes('galeArt'))))value+=4;
 // Specialties are options, not unconditional large retention bonuses.
 for(const skill of ['flashTrap','precisionShot','angelWall'])if(cards.some(c=>c.uniqueSkills.includes(skill)))value+=2;
 return value-burden(p.count,p.limit);
}
export function energyPlan(s,p) {
 const total=p.energy.gem+p.energy.crystal;if(!total)return 0;
 if(p.id!==s.observer)return total*3;
 const attacks=p.hand.filter(c=>c.type==='attack'),enemies=s.players.filter(t=>t.team!==p.team);
 let use=0;
 if(p.hero==='berserker'&&p.energy.gem&&attacks.length)use=8;
 if(p.hero==='windSwordmaster'&&attacks.length>=2)use=7;
 if(p.hero==='marksman'&&attacks.length&&enemies.some(t=>t.count<5))use=5;
 if(p.hero==='priest'&&p.hand.length>=2&&p.healing>0)use=9;
 if(p.hero==='sealer')use=s.players.some(t=>t.effects.length)?7:4;
 if(p.hero==='guardianAngel')use=6;
 return total*.5+use; // Only the first currently evidenced use earns preparation value.
}
export function nextTurnRisk(s,playerId=s.observer) {
 const p=s.players[playerId];let risk=0,pressure=0,defenses=p.hand.filter(c=>['darkStrike','holyLight'].includes(c.name)).length;
 const coverage=new Set(p.hand.filter(c=>c.type==='attack').flatMap(c=>traits(c,p.id)));
 // Residual value to our next effective action. Public seats and resources only.
 // This is a threat estimate, not a simulation with actual hidden cards.
 for(let step=1;step<=s.players.length;step++) {
  const t=s.players[(s.current+step)%s.players.length];if(t.id===p.id)break;
  if(t.team===p.team) {
   if(t.hero==='priest'&&t.count>=2)pressure=Math.max(0,pressure-.25);
   continue;
  }
  if(!t.count)continue;
  const activity=Math.min(.8,.2+t.count*.1),aim=1/Math.max(1,s.players.filter(x=>x.team===p.team).length);
  let block=p.id!==s.observer?1-.75**p.count:defenses>0?.75:Math.min(.5,coverage.size*.09);
  if(defenses>0)defenses-=activity*aim;
  const force=t.hero==='marksman'?.15:t.hero==='windSwordmaster'&&t.count>=3?.2:0;
  block*=1-force;
  const amount=t.hero==='berserker'?3+(t.energy.gem?1:0):t.hero==='windSwordmaster'&&t.count>=3?3:2;
  const shield=p.effects.some(e=>e.name==='holyShield')?.4:0;
  pressure+=activity*aim*(1-block)*(1-shield)*amount;
  const overflow=Math.max(0,p.count+pressure-Math.min(p.healing,p.hero==='priest'?1:pressure)-p.limit);
  risk=Math.max(risk,overflow*weights.morale);
 }
 // Delay caused by public weakness is a lost opportunity, not free waiting.
 if(p.effects.some(e=>e.name==='weakness'||e.name==='fivefoldBinding'))risk+=pressure*2;
 if(risk/weights.morale>=s.teams[p.team].morale)risk+=200;
 return risk?-risk:0;
}
function effectValue(s,p,e) {
 if(e.name==='holyShield')return 3+Math.max(0,p.count-3)*2;
 if(e.name==='poison')return -2-Math.max(0,p.count-4)*5;
 if(e.name==='weakness'||e.name==='fivefoldBinding')return -5-Math.max(0,p.count-3)*2;
 if(e.name.endsWith('Seal')) {
  const element=e.name.slice(0,-4),known=p.id===s.observer?p.hand:p.known;
  const share=p.id===s.observer?known.filter(c=>traits(c,p.id).includes(element)).length/Math.max(1,p.count):.2;
  return -(2+Math.max(0,p.count-3)*2)*share;
 }
 return 0;
}
export function components(s) {
 const team=s.players[s.observer].team, out={morale:0,cups:0,stones:0,conversion:0,ownHand:0,otherHands:0,healing:0,energy:0,effects:0,nextTurnRisk:s.economy?nextTurnRisk(s):0,otherTurnRisk:0,terminal:0};
 for(const [id,t] of Object.entries(s.teams)) {
  const sign=id===team?1:-1;
  out.morale+=sign*(t.morale*weights.morale-3*Math.max(0,5-t.morale)**2);
  out.cups+=sign*t.cups*weights.cup;out.stones+=sign*(t.gem+t.crystal)*weights.stone;
  // Discounted next-turn synthesis option; paid out of the same potential when
  // stones are consumed. No unconditional reward for acquiring/using resources.
  const readiness=Math.max(...s.players.filter(p=>p.team===id).map(p=>p.count<=3?.8:p.count===4?.4:.15));
  out.conversion+=sign*readiness*(Math.min(3,t.gem+t.crystal)/3)**2*18;
  if(t.morale<=0)out.terminal-=sign*100000;if(t.cups>=5)out.terminal+=sign*100000;
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
   const useful=p.hero==='marksman'&&traits(c,p.id).includes('thunder')?1.5:0;
   const seal=p.effects.some(e=>e.name.endsWith('Seal')&&traits(c,p.id).includes(e.name.slice(0,-4)));
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
 if(spell)for(const angel of s.players.filter(t=>t.team===p.team&&t.hero==='guardianAngel')) {
  const protection=Math.min(loss,angel.energy.gem+angel.energy.crystal);payEnergy(s,angel.id,protection);loss-=protection;
 }
 s.teams[p.team].morale-=loss;p.count-=excess;
 while(p.hand.length>p.count) {
  const ranked=p.hand.map(c=>{const t=clone(s);remove(t,id,[c]);return {c,v:handValue(t,t.players[id])};}).sort((a,b)=>b.v-a.v);
  p.hand=p.hand.filter(c=>c.id!==ranked[0].c.id);
 }
}
export function draw(s,id,n,options) {s.players[id].count+=Math.max(0,n);overflow(s,id,options);}
export function heal(s,id,n) {const p=s.players[id];p.healing=Math.min(p.healingLimit,p.healing+n);}
export function payEnergy(s,id,n=1,kind='crystal') {
 const e=s.players[id].energy;if(kind==='gem'){e.gem-=n;return;}
 const crystals=Math.min(e.crystal,n);e.crystal-=crystals;e.gem-=n-crystals;
}
export function stones(s,team,kind,n) {const t=s.teams[team];t[kind]+=n>0?Math.min(n,Math.max(0,5-t.gem-t.crystal)):n;}
export function damage(s,id,n,damageType='spell') {
 const p=s.players[id];
 // Unknown opponents use public overflow-prevention healing; own player compares
 // all legal healing expenditures on the same utility scale.
 const cap=Math.min(p.healing,n,p.hero==='priest'?1:n);
 let spend=Math.min(cap,Math.max(0,p.count+n-p.limit));
 if(id===s.observer) {
  let best=-Infinity;for(let h=0;h<=cap;h++){const t=clone(s);t.players[id].healing-=h;draw(t,id,n-h,{spell:damageType==='spell'});const v=value(t);if(v>best){best=v;spend=h;}}
 }
 p.healing-=spend;draw(s,id,n-spend,{spell:damageType==='spell'});
}
export function expose(s,id,cards) {
 const p=s.players[id];for(const effect of [...p.effects])if(effect.name.endsWith('Seal')&&cards.some(c=>traits(c,id).includes(effect.name.slice(0,-4)))) {
  p.effects=p.effects.filter(e=>e!==effect);damage(s,id,3);
 }
}
export function spend(s,id,cards,{publicExposure=true}={}) {remove(s,id,cards);if(publicExposure)expose(s,id,cards);}
export function transfer(s,id,targetId,c) {
 remove(s,id,[c]);const t=s.players[targetId];t.count++;
 if(targetId===s.observer)t.hand.push(c);else t.known.push(c);
}
