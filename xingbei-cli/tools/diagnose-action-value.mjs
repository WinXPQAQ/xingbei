import fs from 'node:fs';import {execFileSync} from 'node:child_process';import {getPolicy} from '../src/ai/versions.js';import {observationView} from '../src/ai/observation.js';
import {stateOf,energyPlan} from '../src/ai/v1.3-economy4/model.js';import {actionPlan} from '../src/ai/v1.3-economy4/planner.js';
const cases=JSON.parse(fs.readFileSync('artifacts/ai/mandatory-action/negative-cases.json'));
const s=stateOf(observationView(cases[0].observation),2);
const windEnergy=[false,true].map(sequence=>{const p=actionPlan(s,2,{type:'play',index:1,targetId:0},{sequence});return{sequence,score:p.score,before:{energy:s.players[2].energy,value:energyPlan(s,s.players[2])},branches:p.branches.map(b=>({probability:b.probability,path:b.path,energy:b.state.players[2].energy,value:energyPlan(b.state,b.state.players[2])}))};});
const comparison=cases.map(c=>({sha:c.sha,config:c.config,actorId:c.actorId,original:c.ranked,versions:Object.fromEntries(['experimental/economy-capability-1','experimental/action-value-1'].map(version=>[version,getPolicy(version).replayTrace({version,observation:c.observation})]))}));
fs.writeFileSync('artifacts/ai/action-value-1/original-case-comparison.json',JSON.stringify({candidateSHA:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),windEnergy,comparison},null,2));
console.log(comparison.map((c,i)=>({case:i+1,versions:Object.fromEntries(Object.entries(c.versions).map(([v,r])=>[v,r.slice(0,3).map(x=>({action:x.action,score:x.score}))]))})));
