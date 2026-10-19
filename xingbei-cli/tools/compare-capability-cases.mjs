// Rescore the original detached decision snapshots, never rerun/overwrite games.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {getPolicy} from '../src/ai/versions.js';
import {observationView} from '../src/ai/observation.js';
import {legalActions} from '../src/legal-actions.js';
const root=new URL('../',import.meta.url);
const source='artifacts/ai/mandatory-action/negative-cases.json';
const bytes=await readFile(new URL(source,root)),cases=JSON.parse(bytes);
const sha256=b=>createHash('sha256').update(b).digest('hex');
const candidate='experimental/economy-capability-1';
const key=a=>JSON.stringify([a.type,a.index,a.targetId,a.skillId,a.mode,a.cardIds,a.targetIds,a.gemCount,a.stones?.gem,a.stones?.crystal]);
const pairs=cases.map(c=>{
 const legal=new Set(legalActions(observationView(c.observation),c.actorId).map(key));
 const rank=version=>getPolicy(version).replayTrace({version,configuration:{sequence:true,economy:true},observation:c.observation}).filter(r=>legal.has(key(r.action)));
 const before=rank('experimental/economy-4'),after=rank(candidate);
 assert.deepEqual(JSON.parse(JSON.stringify(before)),c.ranked,'Original frozen scores must reproduce exactly');
 assert.equal(after.length,before.length);
 assert.deepEqual([...after.map(r=>key(r.action))].sort(),[...before.map(r=>key(r.action))].sort());
 return {originalSHA:c.sha,config:c.config,turn:c.turn,actorId:c.actorId,hero:c.hero,originalChosen:c.action,
  originalAllNegative:before.every(r=>r.score<0),candidateAllNegative:after.every(r=>r.score<0),candidateChosen:after[0].action,
  before,after,changes:before.map(r=>{const n=after.find(x=>key(x.action)===key(r.action));return {action:r.action,before:r.score,after:n.score,delta:n.score-r.score};})};
});
const sourceHashes={};
for(const f of ['src/ai/economy-capability1/model.js','src/ai/economy-capability1/planner.js','src/ai/economy-capability1/index.js','src/ai/versions.js'])sourceHashes[f]=sha256(await readFile(new URL(f,root)));
const output={candidate,baseCommit:'abc939877a12ecedd60b3d7e97eb5f7b4ae2d195',sourceHashes,originalCases:{path:source,sha256:sha256(bytes)},scope:'Same detached public snapshots only. New choices and scores are counterfactual; no new game outcomes or win-rate evidence.',cases:pairs};
await writeFile(new URL('artifacts/ai/capability-1/case-comparison.json',root),JSON.stringify(output,null,2)+'\n');
for(const c of pairs)console.log(JSON.stringify({hero:c.hero,old:c.before[0].score,new:c.after[0].score,oldAction:c.originalChosen,newAction:c.candidateChosen,allNegative:c.candidateAllNegative}));
