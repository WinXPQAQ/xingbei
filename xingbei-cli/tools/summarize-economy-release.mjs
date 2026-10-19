import {readFile,readdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=new URL('../artifacts/ai/economy/release/',import.meta.url),protocol=JSON.parse(await readFile(new URL('protocol.json',root),'utf8'));
const chunks=[];for(const f of (await readdir(new URL('chunks/',root))).filter(x=>x.endsWith('.json')))chunks.push(JSON.parse(await readFile(new URL('chunks/'+f,root),'utf8')));
const commits=new Set(chunks.map(r=>r.commit));assert.equal(commits.size,1);assert.ok(chunks.every(r=>r.sourceUnchanged));
const score=r=>r.outcome==='win'?1:r.outcome==='loss'?0:.5;
const key=r=>[r.lineup,r.seed,r.start,r.team].join('/');
function interval(values,alpha=.05){let rng=391827,random=()=>((rng=(Math.imul(rng,1664525)+1013904223)>>>0)/2**32);const samples=[];
 for(let i=0;i<10000;i++){let n=0;for(let j=0;j<values.length;j++)n+=values[Math.floor(random()*values.length)];samples.push(n/values.length);}samples.sort((a,b)=>a-b);
 return [samples[Math.floor(alpha/2*samples.length)],samples[Math.ceil((1-alpha/2)*samples.length)-1]];
}
function means(rows,fn=score){return [...new Set(rows.map(r=>r.seed))].sort((a,b)=>a-b).map(seed=>{const xs=rows.filter(r=>r.seed===seed);return xs.reduce((n,r)=>n+fn(r),0)/xs.length;});}
function summarize(rows){const m=means(rows);return {games:rows.length,seedClusters:m.length,wins:rows.filter(r=>r.outcome==='win').length,losses:rows.filter(r=>r.outcome==='loss').length,truncated:rows.filter(r=>!['win','loss'].includes(r.outcome)).length,score:rows.reduce((n,r)=>n+score(r),0)/rows.length,cluster95:interval(m)};}
const records=[],raw=new Map();
for(const phase of ['primary','styles']){const config=protocol[phase];for(const [candidate,opponent]of config.pairs){
 const parts=chunks.filter(r=>r.settings.phase===phase&&r.settings.candidate===candidate&&r.settings.opponent===opponent),rows=parts.flatMap(r=>r.results);
 assert.equal(rows.length,config.gamesPerPair);assert.equal(new Set(rows.map(key)).size,rows.length);
 const expected=new Set(config.rosters.flatMap(lineup=>Array.from({length:config.seeds},(_,i)=>config.firstSeed+i).flatMap(seed=>config.starts.flatMap(start=>config.colors.map(team=>[lineup,seed,start,team].join('/'))))));assert.deepEqual(new Set(rows.map(key)),expected);
 const group=field=>Object.fromEntries([...new Set(rows.map(r=>r[field]))].map(k=>[k,summarize(rows.filter(r=>r[field]===k))]));
 raw.set(candidate+'|'+opponent,rows);records.push({phase,candidate,opponent,...summarize(rows),byLineup:group('lineup'),byStart:group('start'),byColor:group('team')});
}}
function contrast(candidate,opponent,baseline,filter=()=>true){const a=raw.get(candidate+'|'+opponent).filter(filter),b=new Map(raw.get(baseline+'|'+opponent).filter(filter).map(r=>[key(r),r]));
 assert.equal(a.length,b.size);for(const r of a)assert.deepEqual(r.heroIds,b.get(key(r))?.heroIds);
 const m=means(a,r=>score(r)-score(b.get(key(r))));return {games:a.length,seedClusters:m.length,mean:m.reduce((a,b)=>a+b,0)/m.length,cluster95:interval(m),simultaneousFourLineup9875:interval(m,.0125),seedDifferences:m};
}
const candidate=protocol.candidate,comparisons={overall:contrast(candidate,'v1.2','v1.2'),versusV10:contrast(candidate,'v1.0','v1.2'),lineups:Object.fromEntries(protocol.primary.rosters.map(k=>[k,contrast(candidate,'v1.2','v1.2',r=>r.lineup===k)])),styles:Object.fromEntries(['experimental/style-flow','experimental/style-reserve'].map(o=>[o,contrast(candidate,o,'v1.2')]))};
const record=(a,b)=>records.find(r=>r.candidate===a&&r.opponent===b),v12=record(candidate,'v1.2'),v10=record(candidate,'v1.0');
const gates={overallImprovement:v12.score>=.53&&v12.cluster95[0]>.5&&comparisons.overall.mean>=.03&&comparisons.overall.cluster95[0]>0,
 versusV10:v10.cluster95[0]>.5&&comparisons.versusV10.cluster95[0]>-.05,
 majorLineups:Object.values(comparisons.lineups).every(r=>r.cluster95[0]>-.05),
 styles:Object.entries(comparisons.styles).every(([o,r])=>record(candidate,o).score>=.5&&r.cluster95[0]>-.05),
 truncation:records.every(r=>r.truncated/r.games<=.01)};
const result={candidateCommit:[...commits][0],games:records.reduce((n,r)=>n+r.games,0),passed:Object.values(gates).every(Boolean),gateScope:'Numerical gates only; correctness/privacy/performance separate',gates,simultaneousLineupNoninferiority:Object.values(comparisons.lineups).every(r=>r.simultaneousFourLineup9875[0]>-.05),comparisons,records,limits:['30 primary seed clusters shared across comparisons; 6 separate style clusters','Intervals crossing -5pp noninferiority margin are inconclusive; non-significance is not no-regression proof','Marginal95% and Bonferroni98.75% lineup intervals both disclosed','No global optimality or human-strength claim']};
assert.equal(result.games,protocol.totalGames);await writeFile(new URL('summary.json',root),JSON.stringify(result,null,2));console.log(JSON.stringify({commit:result.candidateCommit,games:result.games,passed:result.passed,gates,simultaneousLineupNoninferiority:result.simultaneousLineupNoninferiority,comparisons,records:records.map(({byLineup,byStart,byColor,...r})=>r)},null,2));
