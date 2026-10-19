import fs from 'node:fs';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {Game} from '../../../../src/engine.js';import {captureObservation} from '../../../../src/ai/observation.js';import {playEconomyMatch} from '../../../../tools/ai/economy-evaluate.mjs';
const root=new URL('./',import.meta.url),protocol=JSON.parse(fs.readFileSync(new URL('stress-protocol.json',root)));const git=(...a)=>execFileSync('git',a,{encoding:'utf8'}).trim();const lock=()=>{assert.equal(git('rev-parse','HEAD'),protocol.deliverySHA);assert.equal(git('diff',protocol.frozenSHA,'--','src','tools','test','docs/ai-targeted-fixes-1-protocol.md'),'');};lock();
const snapshots=[],matches=[],missing=[];
for(const seed of protocol.seeds){
 for(const [id,hero]of protocol.heroes.entries())for(const count of [3,6]){
  const g=new Game({seed,heroIds:protocol.heroes}).setup();while(g.player(id).hand.length>count)g.moveCard(g.player(id).hand.at(-1).id,{zone:'discard'});while(g.player(id).hand.length<count)g.moveCard(g.deck.at(-1).id,{zone:'hand',playerId:id});g.current=id;g.startTurn(id);g.assertCardLocations();assert.equal(g.player(id).hand.length,count);snapshots.push({seed,hero,cell:'hand'+count,actorId:id,source:'isolated-engine-fixture',observation:captureObservation(g,id,{actions:true})});
 }
 const found=new Set();outer:for(let start=0;start<6;start++)for(const team of ['red','blue']){
  const config={seed,heroIds:protocol.heroes,lineup:'sixHeroesStress',start,team};const result=await playEconomyMatch(config,{candidate:'experimental/targeted-fixes-1',opponent:'v1.3',turnLimit:300,decisionVersions:['experimental/targeted-fixes-1','v1.3'],onOrdinaryDecision:e=>{const hero=e.observation.players[e.actorId].hero.id;if(e.action.type==='refresh'||e.observation.publicHistory.events.length<100||found.has(hero))return;found.add(hero);snapshots.push({seed,hero,cell:'history100',actorId:e.actorId,turn:e.turn,config,source:'natural-game',observation:e.observation});}});matches.push(result);if(found.size===6)break outer;
 }
 for(const hero of protocol.heroes)if(!found.has(hero))missing.push({seed,hero,cell:'history100'});console.log({seed,snapshots:snapshots.length,missing:missing.length});
}lock();fs.writeFileSync(new URL('stress-snapshots.json',root),JSON.stringify({sha:protocol.frozenSHA,protocol:'stress-protocol.json',snapshots,matches,missing},null,2));assert.equal(missing.length,0,'Missing stress cells; retain evidence, do not substitute seeds');
