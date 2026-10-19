// Bounded public-state opportunities, not win probabilities. No unseen cards or
// imagined ordinary attack followed by synthesis in the same turn.
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const distance=(s,p)=>(p.id-s.current+s.players.length)%s.players.length||s.players.length;
function intervening(s,p){return Array.from({length:distance(s,p)-1},(_,i)=>s.players[(s.current+i+1)%s.players.length]);}
export function conversionChance(s,p) {
 const between=intervening(s,p),foes=between.filter(t=>t.team!==p.team&&t.count>0);
 // Responses before the turn may reduce four cards to three. Never assume a
 // particular hidden response. More opposing actions also risk padding the hand.
 const responseChance=clamp(foes.length*.12,0,.35);
 let ready=p.count<=3?.9:p.count===4?.08+responseChance:.025;
 const defense=p.id===s.observer?Math.min(.65,p.hand.filter(c=>['holyLight','darkStrike'].includes(c.name)).length*.3):.2;
 const padding=foes.length*.075*(1-defense)*Math.max(.25,(p.count+1)/4);
 ready*=clamp(1-padding,.35,1);
 if(p.effects.some(e=>['weakness','fivefoldBinding'].includes(e.name)))ready*=.45;
 return ready*.93**distance(s,p);
}
export function teamOpportunity(s,team) {
 const t=s.teams[team],resource=clamp((t.gem+t.crystal)/3)**3;
 const chances=s.players.filter(p=>p.team===team).map(p=>conversionChance(s,p));
 // One shared resource pool and earliest usable conversion: don't add three
 // separate winning opportunities or reward low hand repeatedly.
 const best=Math.max(0,...chances),rival=s.teams[team==='red'?'blue':'red'];
 const survival=clamp(t.morale/5,.15,1);
 const race=rival.cups===4&&rival.gem+rival.crystal>=3?.75:1;
 return (t.cups===4?180:6+4*t.cups)*resource*best*survival*race;
}
export function capacityCost(s,team) {
 const t=s.teams[team],full=clamp(t.gem+t.crystal-4);
 if(!full)return 0;
 const allies=s.players.filter(p=>p.team===team);
 // A visible attack opportunity can generate stars before conversion. Unknown
 // teammate cards get a conservative count-only estimate, never their faces.
 const gains=allies.reduce((sum,p)=>sum+(p.id===s.observer?Number(p.hand.some(c=>c.type==='attack'))*.45:Math.min(.45,p.count*.075)),0);
 return full*Math.min(2,gains)*3;
}
export function drawDanger(s,p) {
 const morale=s.teams[p.team].morale;if(morale>5||p.count<4)return 0;
 const foes=intervening(s,p).filter(t=>t.team!==p.team&&t.count>0);
 const coverage=p.id===s.observer?new Set(p.hand.filter(c=>c.type==='attack').flatMap(c=>c.traits?.[p.id]?.elements??c.elements)).size:1;
 const emergency=p.id===s.observer?p.hand.filter(c=>['holyLight','darkStrike'].includes(c.name)).length:.3;
 const protection=clamp(.09*coverage+.3*emergency+.08*p.healing,0,.8);
 const incoming=foes.reduce((n,t)=>n+(t.hero==='berserker'?3:2)*.3,0)*(1-protection);
 // Stress estimate is combined with the old risk by maximum (not addition);
 // terminal victory still dominates every nonterminal option by orders of magnitude.
 return Math.min(60,Math.max(0,p.count+incoming-p.limit+.5)*(6-morale)*4);
}
