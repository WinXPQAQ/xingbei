import fs from 'node:fs';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {playEconomyMatch} from '/workspace/xingbei-action-value2/xingbei-cli/tools/ai/economy-evaluate.mjs';
const git=(...a)=>execFileSync('git',a,{encoding:'utf8'}).trim(),sha=git('rev-parse','HEAD'),version='experimental/action-value-2';
assert.equal(git('diff','HEAD','--','src','tools','test'),'');
const {rosters,starts,colors}=JSON.parse(fs.readFileSync('artifacts/ai/mandatory-refresh/protocol.json'));
const cases=[],matches=[];let negativeEvents=0,ordinaryEvents=0;
outer:for(let seed=883001;seed<=883004;seed++)for(const [lineup,base] of Object.entries(rosters))for(const start of starts)for(const team of colors){
 const config={lineup,heroIds:team==='red'?base:[base[1],base[0],base[3],base[2],base[5],base[4]],seed,start,team},picked=[];
 const outcome=await playEconomyMatch(config,{candidate:version,opponent:'v1.3',turnLimit:300,decisionVersions:[version],onOrdinaryDecision:e=>{
  if(e.action.type==='refresh')return;ordinaryEvents++;if(!e.ranked.length||e.ranked.some(r=>r.score>=0||r.action.type==='pass'||r.action.type==='refresh'))return;negativeEvents++;
  const hero=e.observation.players[e.actorId].hero.id??e.observation.players[e.actorId].hero;
  if(cases.length<5&&!cases.some(c=>c.hero===hero)){const c={sha,config,hero,...e};cases.push(c);picked.push(c);}
 }});for(const c of picked)c.subsequentOutcome=outcome;matches.push(outcome);console.log({games:matches.length,cases:cases.length,negativeEvents});if(cases.length>=5)break outer;
}
assert.equal(git('rev-parse','HEAD'),sha);assert.equal(git('diff','HEAD','--','src','tools','test'),'');
fs.writeFileSync('/tmp/audit-action-value2-natural-replay.json',JSON.stringify({sha,selection:'first all-negative ordinary decision per distinct hero; fixed independent scan order; no private cards',ordinaryEvents,negativeEvents,matches,cases},null,2));
