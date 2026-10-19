export * from '../../../src/ai/targeted-fixes1/planner.js';
import {difference} from '../../../src/ai/targeted-fixes1/model.js';
export function explain(s,plan) {
 const parts=Object.fromEntries(Object.keys(difference(s,s)).map(k=>[k,0]));
 for(const b of plan.branches)for(const [k,v] of Object.entries(difference(s,b.state)))parts[k]+=b.probability*v;
 return {parts,branches:plan.branches.map(b=>({probability:b.probability,path:b.path})),precision:plan.precision??null,search:plan.search??null};
}
