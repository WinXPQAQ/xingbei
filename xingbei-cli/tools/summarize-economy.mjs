import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {summary} from './ai/evaluate.mjs';
const root=new URL('../artifacts/ai/economy/',import.meta.url),protocol=JSON.parse(await readFile(new URL('protocol.json',root),'utf8'));
const reports=[];
for(const [candidate,opponent] of protocol.pairs) {
 const filename=candidate.replaceAll('/','_')+'--'+opponent.replaceAll('/','_')+'.json';
 const original=JSON.parse(await readFile(new URL('acceptance/'+filename,root),'utf8')),reverse=JSON.parse(await readFile(new URL('reverse/'+filename,root),'utf8'));
 assert.equal(original.commit,'a9afb9614dde5af5a25bbb2fcdf11c5fc6ed44a3');assert.equal(reverse.commit,original.commit);
 assert.equal(original.results.length,216);assert.equal(reverse.results.length,72);
 const rows=[...original.results,...reverse.results];assert.equal(new Set(rows.map(r=>[r.lineup,r.seed,r.start,r.team].join('/'))).size,288);
 const totals=Object.fromEntries(['candidate','opponent'].map(side=>[side,Object.fromEntries(Object.keys(rows[0].metrics[side]).map(k=>[k,rows.reduce((n,r)=>n+r.metrics[side][k],0)]))]));
 const diagnostic=Object.fromEntries(Object.entries(totals).map(([side,m])=>[side,{...m,highHandTurnRate:m.highHandTurns/m.turns,idleEnergyTurnRate:m.idleEnergyTurns/m.turns,passPerAction:m.passes/m.actions}]));
 reports.push({candidate,opponent,original:original.summary,combined:summary(rows),originalLineups:original.byLineup,balancedAsymmetric:summary(rows.filter(r=>r.lineup.startsWith('asymmetric'))),diagnostic});
}
const candidateReports=reports.filter(r=>r.candidate==='experimental/economy-1');
const gates=candidateReports.map(r=>{
 const threshold=r.opponent.startsWith('experimental/style')?.5:.55;
 const original=r.original.scoreRate>=threshold&&r.original.truncated/r.original.games<=.01;
 const v12=r.opponent!=='v1.2'||(r.original.clusterBootstrap95[0]>=.45&&Object.values(r.originalLineups).every(x=>x.scoreRate>=.45));
 return {opponent:r.opponent,originalPassed:original&&v12,balancedSupplementPassed:r.combined.scoreRate>=threshold&&r.balancedAsymmetric.scoreRate>=.45&&r.combined.truncated/r.combined.games<=.01};
});
const result={candidateCommit:'a9afb9614dde5af5a25bbb2fcdf11c5fc6ed44a3',games:reports.reduce((n,r)=>n+r.combined.games,0),originalGatesPassed:gates.every(g=>g.originalPassed),balancedSupplementPassed:gates.every(g=>g.balancedSupplementPassed),gates,reports,limitations:['Six seed clusters only; three original rosters plus reverse asymmetric assignment','Independent scoring styles share rule helpers; not proof of human strength','Diagnostic telemetry includes confounding and right censoring; not ground-truth regret']};
await writeFile(new URL('summary.json',root),JSON.stringify(result,null,2));
console.log(JSON.stringify({games:result.games,gates:result.gates,rows:reports.map(r=>({candidate:r.candidate,opponent:r.opponent,wins:r.combined.wins,losses:r.combined.losses,truncated:r.combined.truncated,rate:r.combined.scoreRate,ci:r.combined.clusterBootstrap95,balancedAsymmetric:r.balancedAsymmetric.scoreRate}))},null,2));
