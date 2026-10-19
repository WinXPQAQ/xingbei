import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {Game} from '../src/engine.js';import {getPolicy} from '../src/ai/versions.js';import {captureObservation,observationView} from '../src/ai/observation.js';
import {stateOf,energyPlan,clone,damage,synthesisHealing,difference,specialtyOptionValue} from '../src/ai/targeted-fixes1/model.js';
import {actionPlan,explain} from '../src/ai/targeted-fixes1/planner.js';
const policy=getPolicy('experimental/targeted-fixes-1');
const take=(g,id,pred)=>{const c=g.deck.find(pred);assert(c);g.moveCard(c.id,{zone:'hand',playerId:id});return c;};
const model=(g,id=0)=>stateOf(observationView(captureObservation(g,id)),id);
test('targeted all-off exactly retains stable raw scores and complete rankings on 180 fixed public observations',()=>{
 const snapshots=JSON.parse(fs.readFileSync(new URL('../artifacts/ai/action-value-2-final/stress-snapshots.json',import.meta.url))).snapshots;
 for(const x of snapshots){const obs=x.observation,a=getPolicy('v1.3').replayTrace({version:'experimental/economy-4',observation:obs}),b=getPolicy('experimental/targeted-fixes-1-no-ownership-energy-healing').replayTrace({version:'experimental/targeted-fixes-1-no-ownership-energy-healing',observation:obs});assert.deepEqual(b,a);}
});
test('shared initial components preserve original explanation algorithm and root state',()=>{
 const cases=JSON.parse(fs.readFileSync(new URL('../artifacts/ai/action-value-2/negative-cases.json',import.meta.url))).cases;
 for(const c of cases){const s=stateOf(observationView(c.observation),c.actorId),before=structuredClone(s);for(const {action}of c.ranked){const p=actionPlan(s,c.actorId,action,{sequence:true}),parts=Object.fromEntries(Object.keys(difference(s,s)).map(k=>[k,0]));for(const b of p.branches)for(const[k,v]of Object.entries(difference(s,b.state)))parts[k]+=b.probability*v;assert.deepEqual(explain(s,p).parts,parts);assert.deepEqual(s,before);}}
});
test('wind stored gem does not lose seven points with second attack; paying energy still costs reserve',()=>{
 const g=new Game({heroIds:['windSwordmaster',...Array(5).fill('none')]});take(g,0,c=>c.type==='attack');take(g,0,c=>c.type==='attack');g.player(0).energy.gem=1;g.startTurn(0);const s=model(g);assert.equal(energyPlan(s,s.players[0]),3);s.players[0].hand.pop();s.players[0].count--;assert.equal(energyPlan(s,s.players[0]),3);s.players[0].energy.gem=0;assert.equal(energyPlan(s,s.players[0]),0);
});
test('unowned specialty has no option; owned legal specialty remains useful',()=>{
 const g=new Game({heroIds:['windSwordmaster',...Array(5).fill('none')]});take(g,0,c=>c.uniqueSkills.includes('angelWall'));g.startTurn(0);const s=model(g);assert.equal(specialtyOptionValue(s,s.players[0]),0);s.players[0].skillIds=['angelWall'];assert.equal(specialtyOptionValue(s,s.players[0]),2);for(const p of s.players)p.effects=[{name:'holyShield'}];assert.equal(specialtyOptionValue(s,s.players[0]),0);
});
test('public feasible healing matches actual response, keeps three cards and permits fifth cup',async()=>{
 const g=new Game({heroIds:Array(6).fill('none')});take(g,0,c=>c.type==='attack');for(let i=0;i<3;i++)take(g,1,c=>c.name==='holyLight');g.player(1).healing=2;g.addStones('blue','gem',3);g.teams.blue.cups=4;g.startTurn(0);const s=model(g);damage(s,1,2,'attack');assert.equal(s.players[1].count,3);assert.equal(s.players[1].healing,0);let actual;await g.executeAction(0,{type:'play',index:0,targetId:1},{chooseResponse:()=>null,choose:r=>{const v=policy.chooseAiRuleDecision(r,g);if(r.type==='healing')actual=v;return v;}});assert.equal(actual,2);assert.equal(g.player(1).hand.length,3);g.endTurn();g.startTurn(1);const a=policy.chooseAiAction(g,1);assert.equal(a.type,'synthesize');await g.executeAction(1,a);assert.equal(g.winner,'blue');
});
test('healing protection is feasible and conditioned on cups, shared stones and priest cap',()=>{
 const g=new Game({heroIds:Array(6).fill('none')});for(let i=0;i<3;i++)take(g,1,c=>c.type==='attack');g.player(1).healing=2;g.addStones('blue','gem',3);g.teams.blue.cups=4;g.startTurn(0);const base=model(g);for(const change of ['cups','stones','healing','priest']){const s=clone(base);if(change==='cups')s.teams.blue.cups=3;if(change==='stones')s.teams.blue.gem=2;if(change==='healing')s.players[1].healing=1;if(change==='priest')s.players[1].hero='priest';assert.equal(synthesisHealing(s,1,2),null);damage(s,1,2,'attack');assert(s.players[1].count>3);}
});
test('new variants retain shared required-action and optional-extra boundaries',()=>{
 for(const v of ['experimental/targeted-fixes-1','experimental/targeted-fixes-1-no-ownership','experimental/targeted-fixes-1-no-energy','experimental/targeted-fixes-1-no-healing']){const g=new Game({seed:8123}).setup();g.startTurn(0);assert.notEqual(getPolicy(v).chooseAiAction(g,0).type,'pass');assert(!getPolicy(v).rankAiActions(g,0).some(x=>x.action.type==='pass'));}
});
