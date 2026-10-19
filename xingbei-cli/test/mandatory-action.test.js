import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/engine.js';
import { policies, getPolicy } from '../src/ai/versions.js';
import { legalActions } from '../src/legal-actions.js';
import { legalPolicy } from '../src/ai/legal-policy.js';

const make=()=>new Game({seed:73,heroIds:Array(6).fill('none')});
test('sync, async and direct iterator reject ordinary end without mutating turn',async()=>{
 const g=make();g.startTurn(0);const before=JSON.stringify(g.turn.state);
 assert.throws(()=>g.endTurn(),/必须完成/);
 await assert.rejects(g.endTurnWithDecisions(),/必须完成/);
 assert.throws(()=>g.turn.end().next(),/必须完成/);
 assert.throws(()=>g.skipExtraActions(0));assert.throws(()=>g.executeAction(0,{type:'pass'}));
 assert.equal(JSON.stringify(g.turn.state),before);assert.equal(g.current,0);
 await g.executeAction(0,{type:'purchase'});await g.endTurnWithDecisions();assert.equal(g.current,1);
});
test('unfinished action and mandatory request cannot be bypassed via end',()=>{
 const g=make();g.player(0).handLimit=2;g.startTurn(0);
 const action=g.purchaseSteps(0,{overflow:'defer'}),step=action.next();
 assert.equal(step.value.type,'overflow');assert.throws(()=>g.endTurn(),/必须完成/);
 g.resolveOverflow(0,[0]);assert.equal(action.next().done,true);g.endTurn();
 const h=make();h.startTurn(0);h.turn.beginAction(0,'special').next();
 assert.throws(()=>h.endTurn(),/必须完成/);
 const c=h.deck[0];h.moveCard(c.id,{zone:'hand',playerId:0});
 const request=h.chooseHandCards(0,1);assert.equal(request.next().value.optional,false);
 assert.throws(()=>request.next(null));
 const optional=h.chooseHandCards(0,1,()=>true,{optional:true});optional.next();
 assert.equal(optional.next(null).value,null);
});
test('all frozen versions obey required ordinary and optional extra boundaries',()=>{
 for(const [id,p] of Object.entries(policies)){
  const g=make();g.startTurn(0);
  assert.equal(p.chooseAiAction(g,0).type,'purchase',id);p.runAiAction(g,0);
  for(const c of [...g.player(0).hand])g.moveCard(c.id,{zone:'discard'});
  g.turn.addAttackAction();assert.equal(p.chooseAiAction(g,0).type,'pass',id);
  p.runAiAction(g,0);g.endTurn();assert.equal(g.current,1,id);
 }
});
test('negative ranked actions beat illegal pass; omitted legal choices remain executable',()=>{
 const g=make();g.startTurn(0);
 const p=legalPolicy({rankAiActions:()=>[{action:{type:'pass'},score:0},{action:{type:'purchase'},score:-99}]});
 assert.equal(p.chooseAiAction(g,0).type,'purchase');
 assert.equal(legalPolicy({rankAiActions:()=>[{action:{type:'pass'},score:0}]}).chooseAiAction(g,0).type,'purchase');
 assert.deepEqual(legalActions(g,1),[]);
});
test('unusable high hand refresh preserves mandatory action; low hand purchase completes it',async()=>{
 for(const count of [0,3,4,6]){
  const g=make();for(let i=0;i<count;i++)g.moveCard(g.deck.find(c=>c.name==='holyLight').id,{zone:'hand',playerId:0});
  g.startTurn(0);const a=getPolicy('v1.3').chooseAiAction(g,0);
  assert.equal(a.type,count>=4?'refresh':'purchase');await g.executeAction(0,a);
  if(count>=4){assert.equal(g.turn.state.completed,false);assert.throws(()=>g.endTurn(),/必须完成/);}
  else g.endTurn();g.assertCardLocations();
 }
});
