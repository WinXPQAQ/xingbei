// Opportunity costs belong to the acting hero, not to a printed tag alone.
export const ownSkills = (p,c) => c.uniqueSkills.filter(skill => p.skillIds.includes(skill));
export const ownAttack = (p,c) => c.type === 'attack' && ownSkills(p,c).length > 0;
const elements = (p,c) => c.traits?.[p.id]?.elements ?? c.elements;
export function sameElement(p,a,b) {
 const left = [...new Set(elements(p,a))], right = [...new Set(elements(p,b))];
 return left.length === 1 && right.length === 1 && left[0] === right[0];
}
// A discard set must not lose an owned specialty while keeping an interchangeable
// ordinary attack. Restrict replacements to cards legal for this discard request.
export function preservesSpecialties(p,dropped,allowed=p.hand) {
 const ids = new Set(dropped.map(c=>c.id)), legal = new Set(allowed.map(c=>c.id));
 return !dropped.some(c=>ownAttack(p,c) && p.hand.some(other=>
  legal.has(other.id) && !ids.has(other.id) && other.type==='attack' &&
  !ownAttack(p,other) && sameElement(p,c,other)));
}
export function ordinaryResponse(p,valid,choice) {
 if(!choice)return choice;
 const selected = p.hand[choice.index];
 if(!selected || !ownAttack(p,selected) || selected.name==='darkStrike' ||
    elements(p,selected).some(e=>e==='dark'||e==='light'))return choice;
 const replacement=valid.find(({index})=>{
  const c=p.hand[index];
  return c?.type==='attack' && c.name!=='darkStrike' && !ownAttack(p,c) && sameElement(p,selected,c);
 });
 return replacement ? {...choice,index:replacement.index} : choice;
}
// Existing angel/marksman options and wind combinations stay in the evaluator.
// Seal elements share one use: sealing. Repeated uses retain decreasing value.
export function missingRetention(p) {
 const counts=new Map();
 for(const c of p.hand)for(const skill of ownSkills(p,c)) {
  const key=p.hero==='sealer' && skill.endsWith('Seal') ? 'seal' :
   p.hero==='berserker' && ['bloodyRoar','bloodBlade'].includes(skill) ? skill : null;
  if(key)counts.set(key,(counts.get(key)??0)+1);
 }
 return [...counts.values()].reduce((sum,count)=>sum+Array.from({length:count},(_,i)=>2/(i+1)).reduce((a,b)=>a+b,0),0);
}
export function activeAttackPriority(p,c,target) {
 const skills=ownSkills(p,c);
 if(p.hero==='sealer' && skills.some(skill=>skill.endsWith('Seal')))return -2;
 if(p.hero!=='berserker')return 0;
 return (skills.includes('bloodyRoar') && target.healing===2 ? 2 : 0) +
  (skills.includes('bloodBlade') && [2,3].includes(target.count) ? 2 : 0);
}
