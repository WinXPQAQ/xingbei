import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {playEconomyMatch} from './ai/economy-evaluate.mjs';
import {summary} from './ai/evaluate.mjs';
const stage=process.argv[2]??'development',job=Number(process.argv[3]??0),git=(...a)=>execFileSync('git',a,{encoding:'utf8'}).trim(),sha=git('rev-parse','HEAD');
const jobs=stage==='development'?[['experimental/action-value-1','v1.3']]:[['experimental/action-value-1','v1.3'],['experimental/action-value-1','v1.2'],['experimental/action-value-1','v1.0'],['v1.3','v1.3'],['experimental/action-value-1','experimental/economy-capability-1'],['experimental/action-value-1-no-draws','v1.3'],['experimental/action-value-1-no-tempo','v1.3'],['experimental/action-value-1-no-energy','v1.3'],['experimental/action-value-1-no-allocation','v1.3']];
assert.ok(jobs[job]);assert.equal(git('diff','HEAD','--','src','tools','test','docs/ai-action-value-1-protocol.md'),'');
const [candidate,opponent]=jobs[job],first=stage==='development'?443001:771001,seeds=stage==='development'?2:job<5?6:3;
const {rosters,starts,colors}=JSON.parse(fs.readFileSync('artifacts/ai/mandatory-refresh/protocol.json'));
const results=[];for(let seed=first;seed<first+seeds;seed++){
 for(const [lineup,base] of Object.entries(rosters))for(const start of starts)for(const team of colors){
  const heroIds=team==='red'?base:[base[1],base[0],base[3],base[2],base[5],base[4]];
  results.push(await playEconomyMatch({lineup,heroIds,seed,start,team},{candidate,opponent,turnLimit:300}));
 }
 console.log(JSON.stringify({stage,job,seed,games:results.length}));
}
assert.equal(git('rev-parse','HEAD'),sha);assert.equal(git('diff','HEAD','--','src','tools','test','docs/ai-action-value-1-protocol.md'),'');
const groups=Object.fromEntries(Object.keys(rosters).map(k=>[k,summary(results.filter(r=>r.lineup===k))]));
fs.writeFileSync(`artifacts/ai/action-value-1/${stage}-${job}.json`,JSON.stringify({sha,candidate,opponent,summary:summary(results),groups,results},null,2));
