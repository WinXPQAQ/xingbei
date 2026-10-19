import fs from 'node:fs';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {Game} from '../../../../src/engine.js';import {getPolicy} from '../../../../src/ai/versions.js';import {captureObservation} from '../../../../src/ai/observation.js';
const versions=['experimental/targeted-fixes-1','experimental/targeted-fixes-1-no-ownership','experimental/targeted-fixes-1-no-energy','experimental/targeted-fixes-1-no-healing','experimental/targeted-fixes-1-no-ownership-energy-healing'],checks=[];
for(let id=0;id<6;id++){
 const g=new Game({seed:883010+id}).setup();g.current=id;g.startTurn(id);
 const history=structuredClone(g.publicHistory),observation=captureObservation(g,id,{actions:true});
 const before=versions.map(v=>{const p=getPolicy(v);return{version:v,rank:p.rankAiActions(g,id),trace:p.traceDecision(g,id),action:p.chooseAiAction(g,id)};});
 const counts=g.players.map(p=>p.hand.length);for(const p of g.players)if(p.id!==id)for(const c of [...p.hand])g.moveCard(c.id,{zone:'deck'});g.deck.reverse();
 for(const p of g.players)if(p.id!==id)for(let n=0;n<counts[p.id];n++)g.moveCard(g.deck.at(-1).id,{zone:'hand',playerId:p.id});g.deck.reverse();
 g.publicHistory.events=history.events;g.publicHistory.sequence=history.sequence;assert.deepEqual(captureObservation(g,id,{actions:true}),observation);
 for(const b of before){const p=getPolicy(b.version);assert.deepEqual(p.rankAiActions(g,id),b.rank);assert.deepEqual(p.traceDecision(g,id),b.trace);assert.deepEqual(p.chooseAiAction(g,id),b.action);assert.deepEqual(p.replayTrace(b.trace),b.trace.candidates);checks.push({observer:id,hero:g.player(id).hero.id,version:b.version,passed:true});}
}
fs.writeFileSync(new URL('./independent-privacy.json',import.meta.url),JSON.stringify({sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),checks,scope:'30 same-public-state counterfactuals; not a formal proof or exhaustive nested-request audit'},null,2));console.log('30 privacy counterfactuals passed');
