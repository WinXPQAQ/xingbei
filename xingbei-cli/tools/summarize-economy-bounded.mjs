import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {summary} from './ai/evaluate.mjs';
const root=new URL('../artifacts/ai/economy/',import.meta.url).pathname,protocol=JSON.parse(await readFile(root+'bounded-protocol.json','utf8')),sha='98774b0d95c77d146c3a0b4ca8648e9632f79383';
const reports=[],raw=new Map();
for(const [candidate,opponent] of protocol.pairs){
const filename=candidate.replaceAll('/','_')+'--'+opponent.replaceAll('/','_')+'.json',r=JSON.parse(await readFile(root+'bounded/'+filename,'utf8')),rows=r.results;
raw.set(candidate+'/'+opponent,rows);
assert.equal(r.commit,sha);assert.equal(rows.length,288);assert.equal(new Set(rows.map(x=>[x.lineup,x.seed,x.start,x.team].join('/'))).size,288);
assert.ok(rows.every(x=>x.seed>=82001&&x.seed<=82006));
const group=field=>Object.fromEntries([...new Set(rows.map(x=>x[field]))].map(key=>[key,summary(rows.filter(x=>x[field]===key))]));
const diagnostic=Object.fromEntries(Object.entries(r.telemetry).map(([side,m])=>[side,{...m,highHandTurnRate:m.highHandTurns/m.turns,idleEnergyTurnRate:m.idleEnergyTurns/m.turns,passesPerAction:m.passes/m.actions}]));
reports.push({candidate,opponent,summary:r.summary,byLineup:r.byLineup,balancedAsymmetric:r.balancedAsymmetric,byStart:group('start'),byColor:group('team'),diagnostic});
}
const gates=reports.filter(r=>r.candidate==='experimental/economy-2').map(r=>({opponent:r.opponent,score:r.summary.scoreRate>=(r.opponent.startsWith('experimental/style')?.5:.55),confidence:r.opponent!=='v1.2'||r.summary.clusterBootstrap95[0]>=.45,lineup:r.opponent!=='v1.2'||[r.byLineup.mirrorAssault,r.byLineup.mirrorMixed,r.balancedAsymmetric].every(x=>x.scoreRate>=.45),truncation:r.summary.truncated/r.summary.games<=.01}));
const ablations=[];
const score=r=>r.outcome==='win'?1:r.outcome==='loss'?0:.5;
const full=raw.get('experimental/economy-2/v1.2');
for(const candidate of ['experimental/economy-2-no-sequence','experimental/economy-2-no-hand']) {
 const rows=raw.get(candidate+'/v1.2'), byKey=new Map(rows.map(r=>[[r.lineup,r.seed,r.start,r.team].join('/'),r]));
 const seedDiffs=Array.from({length:6},(_,i)=>{const paired=full.filter(r=>r.seed===82001+i);return paired.reduce((n,r)=>n+score(r)-score(byKey.get([r.lineup,r.seed,r.start,r.team].join('/'))),0)/paired.length;});
 let rng=291827;const random=()=>((rng=(Math.imul(rng,1664525)+1013904223)>>>0)/2**32),estimates=[];
 for(let i=0;i<4000;i++)estimates.push(Array.from({length:6},()=>seedDiffs[Math.floor(random()*6)]).reduce((a,b)=>a+b,0)/6);
 estimates.sort((a,b)=>a-b);ablations.push({comparator:candidate,fullMinusAblation:seedDiffs.reduce((a,b)=>a+b,0)/6,pairedSeedCluster95:[estimates[100],estimates[3899]],seedDiffs});
}
const result={ablations,candidateCommit:sha,games:reports.reduce((n,r)=>n+r.summary.games,0),allPairTruncationPassed:reports.every(r=>r.summary.truncated/r.summary.games<=.01),passed:gates.every(g=>g.score&&g.confidence&&g.lineup&&g.truncation)&&reports.every(r=>r.summary.truncated/r.summary.games<=.01),gateScope:"Numerical evaluation gates only; correctness, privacy and performance are separately evidenced",gates,reports,limitations:['Only six seed clusters; confidence intervals are not human-strength evidence','Beam2 can miss costly early moves that enable later gain;128 attack expansions per root, not a time bound','Gift/activeKeyCardsSpent metrics describe action-chain movements, not causal utility or pure active costs','Gift-next-turn metrics can be repeated per gift and right-censored at game end; no unbiased survival rate claim']};
await writeFile(root+'bounded-summary.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({games:result.games,passed:result.passed,gates,rows:reports.map(r=>({candidate:r.candidate,opponent:r.opponent,...Object.fromEntries(['wins','losses','truncated','scoreRate','clusterBootstrap95'].map(k=>[k,r.summary[k]])),lineups:Object.fromEntries(Object.entries(r.byLineup).map(([k,v])=>[k,v.scoreRate])),balancedAsymmetric:r.balancedAsymmetric.scoreRate}))},null,2));
