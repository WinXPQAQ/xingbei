import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/engine.js';
import {getPolicy} from '../src/ai/versions.js';
import {captureObservation,observationView} from '../src/ai/observation.js';
import {stateOf,heal} from '../src/ai/v1.3-economy4/model.js';
import {actionPlan} from '../src/ai/v1.3-economy4/planner.js';
const state=g=>stateOf(observationView(captureObservation(g,0)),0);
const take=(g,id,predicate)=>{const c=g.deck.find(predicate);assert.ok(c);g.moveCard(c.id,{zone:'hand',playerId:id});return c;};
test('economy-4 healing matches engine below, at, and above the ordinary cap without removing contract healing',()=>{
 for(const initial of [0,1,2,3,4])for(const amount of [1,2,-1,-5]) {
  const g=new Game({seed:13}).setup();g.changeHealing(0,initial,{limit:4});const s=state(g);
  heal(s,0,amount);g.changeHealing(0,amount);assert.equal(s.players[0].healing,g.player(0).healing,`${initial}/${amount}`);
 }
});
test('economy-4 completed waterPower preserves over-cap recipient healing, and still adds below cap',async()=>{
 for(const initial of [1,4]) {
  const g=new Game({seed:13,heroIds:['priest','none','none','none','none','none']});
  const water=take(g,0,c=>c.elements.includes('water'));take(g,0,c=>c.type==='attack');g.changeHealing(3,initial,{limit:4});g.startTurn(0);
  const action={type:'skill',skillId:'waterPower',cardIds:[water.id],targetIds:[3]},s=state(g),plan=actionPlan(s,0,action),p=getPolicy('experimental/economy-4');
  await g.executeAction(0,action,{choose:r=>p.chooseAiRuleDecision(r,g),overflow:'ai'});
  assert.equal(plan.branches[0].state.players[3].healing,g.player(3).healing);assert.equal(g.player(3).healing,initial===4?4:2);g.assertCardLocations();
 }
});
test('shield stagnation permits a positive-costed advance but preserves refusal of lethal exposure',async()=>{
 const build=()=>{
  const g=new Game({seed:45,heroIds:Array(6).fill('none')});
  for(let i=0;i<6;i++)take(g,0,c=>c.name==='fireStrike');
  for(let id=1;id<6;id++)for(let i=0;i<4;i++)take(g,id,c=>c.type==='attack');
  for(const id of [1,2,5]){const c=g.deck.find(c=>c.name==='holyShield');g.attachCard(c.id,id,{effectId:'holyShield'});}
  g.startTurn(0);for(let i=0;i<12;i++)g.publicHistory.append({type:'turn',playerId:i%6});return g;
 };
 const p=getPolicy('experimental/economy-4'),g=build(),rank=p.rankAiActions(g,0)[0];assert.equal(rank.action.type,'play');assert.ok(rank.score>0);
 const target=rank.action.targetId;await g.executeAction(0,rank.action,{chooseResponse:()=>null,overflow:'ai'});assert.equal(g.player(target).getStatus('holyShield').length,0);assert.equal(g.teams.red.morale,15);g.assertCardLocations();
 const h=build(),seal=h.deck.find(c=>c.hasUniqueSkill('fireSeal'));h.attachCard(seal.id,0,{effectId:'fireSeal',sourcePlayerId:1});h.teams.red.morale=1;
 assert.equal(p.chooseAiAction(h,0).type,'pass');
 await h.executeAction(0,{type:'play',index:0,targetId:1},{chooseResponse:()=>null,overflow:'ai'});assert.equal(h.winner,'blue');h.assertCardLocations();
});
