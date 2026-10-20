import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=process.argv[2]??'artifacts/ai/v1.5/confirmation-4';
const manifest=JSON.parse(fs.readFileSync(`${root}/manifest.json`));
// Independently specified acceptance design; do not trust a manifest and its
// result rows merely because they agree with one another.
const requiredRosters={
 mirrorAssault:['berserker','berserker','windSwordmaster','windSwordmaster','marksman','marksman'],
 mirrorMixed:['sealer','sealer','guardianAngel','guardianAngel','priest','priest'],
 asymmetric:['berserker','priest','sealer','marksman','guardianAngel','windSwordmaster'],
 asymmetricReverse:['priest','berserker','marksman','sealer','windSwordmaster','guardianAngel'],
};
const requiredGames=[];
for(const endpoint of ['v1.4','v1.3','v1.2','v1.0','flow','reserve']){
 const mixed=endpoint==='flow'||endpoint==='reserve';
 const seedCount=endpoint==='v1.4'?120:mixed?30:20;
 for(let offset=0;offset<seedCount;offset++)for(const [lineup,baseHeroes]of Object.entries(requiredRosters))for(let start=0;start<6;start++)for(const team of ['red','blue']){
  const seed=1540001+offset,teamSeats=team==='red'?[0,3,4]:[1,2,5];
  const heroIds=team==='red'?[...baseHeroes]:[1,0,3,2,5,4].map(i=>baseHeroes[i]);
  for(const seat of mixed?teamSeats:[null])for(const arm of mixed?['candidate','control']:['candidate']){
   const config={seed,lineup,heroIds,start,team};
   if(mixed){
    config.seatPolicies=Array(6).fill('v1.4');
    for(const teammate of teamSeats)config.seatPolicies[teammate]=`experimental/style-${endpoint}`;
    config.seatPolicies[seat]=arm==='candidate'?'experimental/plans-4':'v1.4';
   }
   requiredGames.push({id:requiredGames.length,endpoint,opponent:mixed?'v1.4':endpoint,seat,arm,
    pairId:mixed?`${endpoint}:${seed}:${lineup}:${start}:${team}:${seat}`:null,config});
  }
 }
}
assert.equal(requiredGames.length,25920);
assert.deepEqual(manifest.games,requiredGames,'Manifest must exactly match the preregistered factorial design');
const rows=fs.readdirSync(root).filter(f=>/^games-\d+\.jsonl$/.test(f)).flatMap(f=>fs.readFileSync(`${root}/${f}`,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse));
assert.equal(manifest.games.length,25920);assert.equal(rows.length,25920);
assert.equal(new Set(rows.map(r=>r.id)).size,25920);
for(let shard=0;shard<4;shard++){
 const done=JSON.parse(fs.readFileSync(`${root}/complete-${shard}.json`));
 assert.equal(done.sha,manifest.sha);assert.equal(done.shard,shard);assert.equal(done.count,4);
}
const exits=JSON.parse(fs.readFileSync(`${root}/runner-exit.json`));
assert.equal(exits.length,4);assert(exits.every(r=>r.code===0));assert.deepEqual(exits.map(r=>r.shard).sort(),[0,1,2,3]);
const expected=new Map(manifest.games.map(r=>[r.id,r]));
assert.equal(expected.size,25920);
for(const row of rows){
 const m=expected.get(row.id);assert(m,'Unexpected ID');
 for(const k of ['endpoint','opponent','seat','arm','pairId','config'])assert.deepEqual(row[k],m[k]);
 for(const [k,v]of Object.entries(m.config))assert.deepEqual(row[k],v);
 assert(['win','loss','truncated'].includes(row.outcome));
 assert(Number.isInteger(row.turns)&&row.turns>=0&&row.turns<=300);
 if(row.outcome==='truncated')assert.equal(row.winner,null);
 else {assert(['red','blue'].includes(row.winner));assert.equal(row.outcome,row.winner===row.team?'win':'loss');}
 assert(!row.error);expected.delete(row.id);
}
assert.equal(expected.size,0);
const rosters=Object.keys(JSON.parse(fs.readFileSync('artifacts/ai/mandatory-refresh/protocol.json')).rosters);
assert.deepEqual(rosters,['mirrorAssault','mirrorMixed','asymmetric','asymmetricReverse']);
const byEndpoint=Object.fromEntries(['v1.4','v1.3','v1.2','v1.0','flow','reserve'].map(e=>[e,rows.filter(r=>r.endpoint===e)]));
const score=r=>r.outcome==='win'?1:r.outcome==='loss'?0:.5;
const absolute=data=>({games:data.length,wins:data.filter(r=>r.outcome==='win').length,losses:data.filter(r=>r.outcome==='loss').length,truncated:data.filter(r=>r.outcome==='truncated').length,score:data.reduce((n,r)=>n+score(r),0)/data.length});
let randomState=1505001;
const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/2**32;};
function interval(data,metric,expectedSeeds,expectedClusterSize){
 const seeds=[...new Set(data.map(r=>r.seed))].sort((a,b)=>a-b);
 assert.deepEqual(seeds,Array.from({length:expectedSeeds},(_,i)=>1540001+i));
 const clusters=seeds.map(seed=>{const group=data.filter(r=>r.seed===seed);assert.equal(group.length,expectedClusterSize);return group.reduce((n,r)=>n+metric(r),0)/group.length;});
 const samples=[];
 for(let i=0;i<10000;i++){let sum=0;for(let j=0;j<seeds.length;j++)sum+=clusters[Math.floor(random()*seeds.length)];samples.push(sum/seeds.length);}
 samples.sort((a,b)=>a-b);
 return {mean:clusters.reduce((a,b)=>a+b,0)/clusters.length,oneSided993Lower:samples[70]};
}
// Fixed endpoint order, with one continuous preregistered LCG stream.
const primary=byEndpoint['v1.4'];
assert.equal(primary.length,5760);
const overall={...absolute(primary),...interval(primary,score,120,48)};
overall.passed=overall.score>=.5&&overall.oneSided993Lower>=.45;
const lineups=Object.fromEntries(rosters.map(lineup=>{
 const data=primary.filter(r=>r.lineup===lineup),r={...absolute(data),...interval(data,score,120,12)};
 r.passed=r.oneSided993Lower>=.45;return [lineup,r];
}));
const mixed={};
for(const style of ['flow','reserve']){
 const data=byEndpoint[style];assert.equal(data.length,8640);
 const pairs=new Map();
 for(const r of data){assert.equal(r.pairId,[style,r.seed,r.lineup,r.start,r.team,r.seat].join(':'));const pair=pairs.get(r.pairId)??{};assert(['candidate','control'].includes(r.arm));assert(!pair[r.arm]);pair[r.arm]=r;pairs.set(r.pairId,pair);}
 assert.equal(pairs.size,4320);
 const differences=[...pairs.values()].map(({candidate:c,control:b})=>{
  assert(c&&b);assert.equal(c.opponent,'v1.4');assert.equal(b.opponent,'v1.4');
  const {seatPolicies:cp,...cc}=c.config,{seatPolicies:bp,...bc}=b.config;assert.deepEqual(cc,bc);
  const seats=c.team==='red'?[0,3,4]:[1,2,5];assert(seats.includes(c.seat));
  for(let i=0;i<6;i++){assert.equal(cp[i],i===c.seat?'experimental/plans-4':seats.includes(i)?`experimental/style-${style}`:'v1.4');assert.equal(bp[i],i===c.seat?'v1.4':cp[i]);}
  return {seed:c.seed,delta:score(c)-score(b)};
 });
 const result={candidate:absolute(data.filter(r=>r.arm==='candidate')),control:absolute(data.filter(r=>r.arm==='control')),...interval(differences,r=>r.delta,30,144)};
 result.passed=result.mean>=0&&result.oneSided993Lower>=-.05;mixed[style]=result;
}
const secondary=Object.fromEntries(['v1.3','v1.2','v1.0'].map(e=>{
 const data=byEndpoint[e];assert.equal(data.length,960);assert.equal(new Set(data.map(r=>r.seed)).size,20);
 const r=absolute(data);r.passed=r.score>=.45;return[e,r];
}));
const passed=rows.every(r=>r.outcome!=='truncated')&&[overall,...Object.values(lineups),...Object.values(mixed),...Object.values(secondary)].every(r=>r.passed);
const result={sha:manifest.sha,games:rows.length,passed,overall,lineups,mixed,secondary,method:'Seven ordered seed-cluster bootstrap endpoints; 10000 draws, continuous LCG1505001, zero-based index70; one-sided99.3%. Mixed arms paired within seed. Old confirmation-3 remains FAIL.'};
fs.writeFileSync(`${root}/summary.json`,JSON.stringify(result,null,2));console.log(result);
if(!passed)process.exitCode=1;
