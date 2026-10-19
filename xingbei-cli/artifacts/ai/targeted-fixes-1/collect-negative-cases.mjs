import fs from 'node:fs';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {playEconomyMatch} from '../../../tools/ai/economy-evaluate.mjs';
import {legalActions} from '../../../src/legal-actions.js';import {observationView} from '../../../src/ai/observation.js';
assert(process.argv.includes('--parent-confirmed-final-gates-passed'),'Wait for explicit parent confirmation of all final gates');
const output=new URL('negative-cases.json',import.meta.url);assert(!fs.existsSync(output),'Keep original case scan; do not overwrite');
const actionKey=a=>JSON.stringify([a.type,a.index,a.targetId,a.skillId,a.mode,a.cardIds,a.targetIds,a.gemCount,a.stones?.gem,a.stones?.crystal]);
const git=(...a)=>execFileSync('git',a,{encoding:'utf8'}).trim(),sha=git('rev-parse','HEAD'),version='experimental/targeted-fixes-1';
assert.equal(sha,'0ada54a7d978d29164c35164d56717f54728b153');assert.equal(git('diff',sha,'--','src','tools','test'),'');
const {rosters,starts,colors}=JSON.parse(fs.readFileSync('artifacts/ai/mandatory-refresh/protocol.json'));
const cases=[],matches=[];let negativeEvents=0,ordinaryEvents=0;
outer:for(let seed=1102001;seed<=1102004;seed++)for(const [lineup,base] of Object.entries(rosters))for(const start of starts)for(const team of colors){
 const config={lineup,heroIds:team==='red'?base:[base[1],base[0],base[3],base[2],base[5],base[4]],seed,start,team},picked=[];
 const outcome=await playEconomyMatch(config,{candidate:version,opponent:'v1.3',turnLimit:300,audit:true,decisionVersions:[version],onOrdinaryDecision:e=>{
  if(e.action.type==='refresh')return;ordinaryEvents++;
  const legal=legalActions(observationView(e.observation),e.actorId).map(actionKey).sort(),rankedKeys=e.ranked.map(r=>actionKey(r.action)).sort();assert.deepEqual(rankedKeys,legal,'Ranked choices must cover every legal action exactly');assert(e.ranked.every(r=>Number.isFinite(r.score)),'Non-finite scores cannot be presented as measured negative values');assert.equal(actionKey(e.action),actionKey(e.ranked[0].action),'Actual choice must match ranked best');if(!e.ranked.length||e.ranked.some(r=>r.score>=0||r.action.type==='pass'||r.action.type==='refresh'))return;negativeEvents++;
  const hero=e.observation.players[e.actorId].hero.id??e.observation.players[e.actorId].hero;
  if(cases.length<5&&!cases.some(c=>c.hero===hero)){const c={sha,config,hero,...e};cases.push(c);picked.push(c);}
 }});for(const c of picked)c.subsequentOutcome=outcome;matches.push(outcome);console.log({games:matches.length,cases:cases.length,negativeEvents});if(cases.length>=5)break outer;
}
assert.equal(git('rev-parse','HEAD'),sha);assert.equal(git('diff','HEAD','--','src','tools','test'),'');
fs.writeFileSync(output,JSON.stringify({sha,selection:'first all-negative ordinary decision per distinct hero; fixed independent scan order; no private cards',ordinaryEvents,negativeEvents,matches,cases},null,2),{flag:'wx'});
