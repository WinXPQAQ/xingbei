import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {playEconomyMatch} from './ai/economy-evaluate.mjs';
import {summary} from './ai/evaluate.mjs';
const root=new URL('../',import.meta.url),path='artifacts/ai/mandatory-action/';
const protocol=JSON.parse(await readFile(new URL(path+'protocol.json',root)));
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const sha=git('rev-parse','HEAD');
assert.equal(git('diff','HEAD','--','src','tools','test',path+'protocol.json'),'');
const pair=Number(process.argv[2]),[candidate,opponent]=protocol.pairs[pair],results=[],cases=[];
for(let seed=protocol.firstSeed;seed<protocol.firstSeed+protocol.seeds;seed++){
 for(const [lineup,base] of Object.entries(protocol.rosters))for(const start of protocol.starts)for(const team of protocol.colors){
  const heroIds=team==='red'?base:[base[1],base[0],base[3],base[2],base[5],base[4]],config={lineup,heroIds,seed,start,team},local=[];
  const onOrdinaryDecision=cases.length>=5?null:e=>{
   const hero=e.observation.players[e.actorId].hero.id;
   if(cases.length>=5||!e.ranked.length||!e.ranked.every(r=>Number.isFinite(r.score)&&r.score<0)||cases.some(c=>c.hero===hero))return;
   const entry={sha,config,hero,...e};cases.push(entry);local.push(entry);
  };
  const result=await playEconomyMatch(config,{candidate,opponent,turnLimit:protocol.turnLimit,onOrdinaryDecision});results.push(result);
  for(const c of local)c.subsequentOutcome={winner:result.winner,turns:result.turns,outcome:result.outcome};
 }
 console.log(JSON.stringify({pair,seed,games:results.length,cases:cases.length}));
}
assert.equal(git('rev-parse','HEAD'),sha);assert.equal(git('diff','HEAD','--','src','tools','test',path+'protocol.json'),'');
const groups=Object.fromEntries(Object.keys(protocol.rosters).map(k=>[k,summary(results.filter(r=>r.lineup===k))]));
await writeFile(new URL(path+`pair-${pair}.json`,root),JSON.stringify({sha,candidate,opponent,summary:summary(results),groups,results,cases},null,2));
