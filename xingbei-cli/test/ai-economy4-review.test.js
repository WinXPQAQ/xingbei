import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/engine.js';
import {getPolicy} from '../src/ai/versions.js';
import {captureObservation} from '../src/ai/observation.js';
const p=getPolicy('experimental/economy-4');
const take=(g,id,name)=>{const c=g.deck.find(typeof name==='function'?name:c=>c.name===name);assert.ok(c);return g.moveCard(c.id,{zone:'hand',playerId:id});};

test('real angelBond gives an available ally healing instead of imaginary damage to an over-cap enemy',async()=>{
 const g=new Game({seed:17,heroIds:['guardianAngel','none','none','none','none','none']});
 const card=take(g,0,c=>c.hasUniqueSkill('angelWall'));
 for(const id of [0,4])g.changeHealing(id,2);g.changeHealing(1,4,{limit:4});
 g.startTurn(0);let seen=false;
 await g.executeAction(0,{type:'skill',skillId:'angelWall',cardIds:[card.id],targetIds:[3]},{choose:r=>{
  if(r.skillId==='angelBond'){
   seen=true;assert.equal(getPolicy('experimental/economy-3').chooseAiRuleDecision(r,g),1,'Frozen bug reproduces on identical real request');
   const trace=p.traceDecision(g,0,r);assert.equal(trace.decision,3);assert.equal(p.replayTrace(JSON.parse(JSON.stringify(trace))),3);
  }
  return p.chooseAiRuleDecision(r,g);
 },overflow:'ai'});
 assert.ok(seen);assert.equal(g.player(1).healing,4);assert.equal(g.player(3).healing,1);g.assertCardLocations();
});

test('real angelBond preserves over-cap friendly healing while giving a different ally useful healing',async()=>{
 const g=new Game({seed:18,heroIds:['guardianAngel','none','none','none','none','none']}),card=take(g,0,c=>c.hasUniqueSkill('angelWall'));
 g.changeHealing(0,2);g.changeHealing(3,4,{limit:4});g.changeHealing(1,4,{limit:4});g.startTurn(0);let answer;
 await g.executeAction(0,{type:'skill',skillId:'angelWall',cardIds:[card.id],targetIds:[3]},{choose:r=>{const choice=p.chooseAiRuleDecision(r,g);if(r.skillId==='angelBond')answer=choice;return choice;},overflow:'ai'});
 assert.equal(answer,4);assert.equal(g.player(3).healing,4);assert.equal(g.player(4).healing,1);assert.equal(g.player(1).healing,4);g.assertCardLocations();
});

test('real angelBond with all allies full does not fabricate removal of enemy contract healing',async()=>{
 const g=new Game({seed:19,heroIds:['guardianAngel','none','none','none','none','none']}),card=take(g,0,c=>c.hasUniqueSkill('angelWall'));
 for(const id of [0,3,4])g.changeHealing(id,2);g.changeHealing(1,4,{limit:4});g.startTurn(0);let answer;
 await g.executeAction(0,{type:'skill',skillId:'angelWall',cardIds:[card.id],targetIds:[3]},{choose:r=>{const choice=p.chooseAiRuleDecision(r,g);if(r.skillId==='angelBond')answer=choice;return choice;},overflow:'ai'});
 assert.equal(answer,0);assert.equal(g.player(1).healing,4);assert.equal(g.player(0).healing,2);g.assertCardLocations();
});

test('costly shield breaking is not forced by long public stagnation; privacy and deterministic replay remain intact',()=>{
 const g=new Game({seed:21,heroIds:Array(6).fill('none')});take(g,0,'darkStrike');for(let i=0;i<3;i++)take(g,0,'holyLight');
 for(let id=1;id<6;id++)for(let i=0;i<4;i++)take(g,id,c=>c.type==='attack');
 for(const id of [1,2,5]){const c=g.deck.find(c=>c.name==='holyShield');g.attachCard(c.id,id,{effectId:'holyShield'});}
 g.startTurn(0);for(let i=0;i<12;i++)g.publicHistory.append({type:'turn',playerId:i%6});
 const snapshot=JSON.stringify(g.toJSON()),trace=p.traceDecision(g,0);assert.equal(JSON.stringify(g.toJSON()),snapshot);
 assert.equal(trace.candidates[0].action.type,'pass','Do not sacrifice costly defensive cards merely to break stagnation');assert.deepEqual(p.replayTrace(JSON.parse(JSON.stringify(trace))),trace.candidates);
 const observation=captureObservation(g,0,{actions:true});
 for(let id=1;id<6;id++)for(const c of [...g.player(id).hand])g.moveCard(c.id,{zone:'deck'});
 for(const c of [...g.deck].reverse())g.moveCard(c.id,{zone:'deck'});
 for(let id=1;id<6;id++)for(let i=0;i<4;i++)g.moveCard(g.deck[0].id,{zone:'hand',playerId:id});
 g.publicHistory.events=observation.publicHistory.events;g.publicHistory.sequence=observation.publicHistory.sequence;
 assert.deepEqual(p.traceDecision(g,0),trace);
 p.chooseAiAction(new Game({seed:22}).setup(),3);assert.deepEqual(p.traceDecision(g,0),trace);
 g.publicHistory.events=g.publicHistory.events.slice(-11);g.publicHistory.sequence--;
 assert.equal(p.chooseAiAction(g,0).type,'pass','Shorter history also does not force a costly action');
});
