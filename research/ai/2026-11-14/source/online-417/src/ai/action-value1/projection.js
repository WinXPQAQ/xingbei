// A public catalogue prior conditioned only on the observer's initial cards.
// This is NOT the actual draw pile or a posterior over opponents' private hands.
import {createDeck} from '../../cards.js';
const catalogue=createDeck().map(c=>({id:c.id,name:c.name,type:c.type,elements:c.elements,uniqueSkills:c.uniqueSkills}));
const choose=(n,k)=>{if(k<0||k>n)return 0;let v=1;for(let i=1;i<=k;i++)v=v*(n-i+1)/i;return v;};
export function publicPrior(hand) {
 const held=new Set(hand.map(c=>c.id)),pool=catalogue.filter(c=>!held.has(c.id));
 const categories={attack:c=>c.type==='attack',defense:c=>c.name==='holyLight'||c.name==='darkStrike',slow:c=>c.type==='spell'&&c.name!=='holyLight',chain:c=>c.type==='attack'&&(c.elements.includes('wind')||c.uniqueSkills.includes('galeArt'))};
 for(const e of ['dark','water','fire','wind','thunder','earth'])categories[e]=c=>c.type==='attack'&&c.elements.includes(e);
 for(const name of ['holyLight','holyShield','poison','weakness','magicBullet'])categories[name]=c=>c.name===name;
 const counts=Object.fromEntries(Object.entries(categories).map(([k,f])=>[k,pool.filter(f).length]));
 return Object.freeze({size:pool.length,counts:Object.freeze(counts)});
}
export function distribution(prior,key,n) {
 n=Math.max(0,Math.min(Math.round(n),prior.size));const k=prior.counts[key],d=choose(prior.size,n);
 return Array.from({length:n+1},(_,i)=>choose(k,i)*choose(prior.size-k,n-i)/d);
}
export const expected=(prior,key,n,f)=>distribution(prior,key,n).reduce((v,q,i)=>v+q*f(i),0);
export const presence=(prior,key,n,known=0)=>known?1:1-distribution(prior,key,n)[0];
export function chainChance(prior,n,attacks,chain,required) {
 if(attacks>=required&&chain)return 1;
 const all=expected(prior,'attack',n,i=>Number(i+attacks>=required));if(chain)return all;
 const N=prior.size,A=prior.counts.attack,B=prior.counts.chain,d=choose(N,n);let noChain=0;
 for(let i=0;i<=n;i++)if(i+attacks>=required)noChain+=choose(A-B,i)*choose(N-A,n-i)/d;
 return Math.max(0,Math.min(1,all-noChain));
}
export function projectedBlock(s,p,coverage,defenses) {
 const n=Math.max(0,p.count-p.hand.length);if(!s.draws||!n)return defenses>0?.75:Math.min(.5,coverage.size*.09);
 const chance=Math.min(Math.max(0,defenses),presence(s.prior,'defense',n,p.hand.filter(c=>c.name==='holyLight'||c.name==='darkStrike').length));
 const projected=[...['dark','water','fire','wind','thunder','earth']].reduce((v,e)=>v+presence(s.prior,e,n,coverage.has(e)?1:0),0);
 // The coverage term is a marginal approximation conditional on no hard defense.
 return chance*.75+(1-chance)*Math.min(.5,projected*.09);
}
export function sharedGemOption(s,team) {
 if(!s.allocation||!s.teams[team].gem)return 0;
 // One shared gem can fund at most one unmet berserker need. No private faces.
 let best=0;for(const p of s.players.filter(p=>p.team===team&&p.hero==='berserker'&&!p.energy.gem&&p.energy.crystal<3)){
  const attack=p.id===s.observer?presence(s.prior,'attack',s.draws?Math.max(0,p.count-p.hand.length):0,p.hand.filter(c=>c.type==='attack').length):1-(1-s.prior.counts.attack/s.prior.size)**p.count;
  const distance=(p.id-s.current+s.players.length)%s.players.length||s.players.length;
  best=Math.max(best,attack/(1+distance/6));
 }
 return best*3; // Same reserve scale as the baseline's unknown energy value.
}
export function spellBacklog(prior,n,knownAttacks,knownSlow) {
 const N=prior.size,A=prior.counts.attack,S=prior.counts.slow,d=choose(N,n);let value=0;
 // Attack and slow-spell counts are mutually exclusive draws, not independent.
 for(let a=0;a<=n;a++)for(let z=0;z<=n-a;z++){
  const q=choose(A,a)*choose(S,z)*choose(N-A-S,n-a-z)/d;
  const backlog=Math.max(0,knownSlow+z+Number(knownAttacks+a>0)-1);value+=q*1.3*backlog*backlog;
 }
 return value;
}
