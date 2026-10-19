import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/engine.js';
import {legalActions} from '../src/legal-actions.js';
import {policies} from '../src/ai/versions.js';
import {Timing} from '../src/timing.js';
const make=(n=4)=>{
 const g=new Game({seed:93,heroIds:['windSwordmaster','priest','guardianAngel','sealer','marksman','berserker']});
 for(let i=0;i<n;i++)g.moveCard(g.deck.find(c=>c.name==='holyLight').id,{zone:'hand',playerId:0});
 g.addStones('red','gem',3);g.startTurn(0);return g;
};
function nextDraw(g,n,predicate){const cards=g.deck.filter(predicate).slice(0,n);assert.equal(cards.length,n);for(const c of cards){g.deck.splice(g.deck.indexOf(c),1);g.deck.push(c);}}
test('three lights allow purchase and refinement; four lights allow exchange OR refinement',async()=>{
 for(const n of [3,4]){
  const g=make(n),a=legalActions(g,0);
  assert.equal(a.some(x=>x.type==='refresh'),n===4);
  assert.equal(a.some(x=>x.type==='purchase'),n===3);
  assert.ok(a.some(x=>x.type==='refine'));
  await g.executeAction(0,a.find(x=>x.type==='refine'));assert.equal(g.turn.state.completed,true);g.endTurn();
 }
});
test('repeated exchanges do not complete action, trigger action timings, or lose queued public exposure',async()=>{
 const g=make(),state=JSON.stringify(g.turn.state),trigger=g.trigger.bind(g),timings=[];
 g.trigger=function*(timing,...args){timings.push(timing);yield* trigger(timing,...args);};
 nextDraw(g,4,c=>c.name==='holyLight');
 await g.executeAction(0,{type:'refresh'});
 assert.equal(JSON.stringify(g.turn.state),state);assert.equal(g.canRefreshUnableHand(0),true);
 assert.throws(()=>g.endTurn(),/必须完成/);assert.equal(g.pendingRuleEvents.length,0);
 assert.ok(timings.includes(Timing.CARD_EXPOSED));
 assert.ok(!timings.includes(Timing.SPECIAL_ACTION_START));assert.ok(!timings.includes(Timing.SPECIAL_ACTION_END));
 nextDraw(g,4,c=>c.type==='attack');await g.executeAction(0,{type:'refresh'});
 assert.equal(JSON.stringify(g.turn.state),state);assert.equal(g.canRefreshUnableHand(0),false);
 assert.throws(()=>g.endTurn(),/必须完成/);
 const a=legalActions(g,0).find(a=>a.type==='play');await g.executeAction(0,a);assert.equal(g.turn.state.completed,true);
 g.skipExtraActions(0);g.endTurn();g.assertCardLocations();
});
test('existing phase restrictions survive exchange; optional extra actions cannot refresh',async()=>{
 const g=make(1);g.turn.state.activationDone=true;
 assert.equal(g.canDrawSpecial(0),false);assert.equal(g.canRefine(0),false);assert.equal(g.canRefreshUnableHand(0),true);
 nextDraw(g,1,c=>c.type==='attack');await g.executeAction(0,{type:'refresh'});
 assert.equal(g.turn.state.activationDone,true);assert.equal(g.turn.state.completed,false);assert.equal(g.canDrawSpecial(0),false);
 await g.executeAction(0,legalActions(g,0).find(a=>a.type==='play'));g.turn.addAttackAction();
 assert.equal(g.canRefreshUnableHand(0),false);assert.ok(legalActions(g,0).some(a=>a.type==='pass'));
});
test('every registered policy repeats exchange then executes an ordinary legal action',()=>{
 for(const [id,p] of Object.entries(policies)){
  const g=make();nextDraw(g,4,c=>c.name==='holyLight');assert.equal(p.chooseAiAction(g,0).type,'refresh',id);p.runAiAction(g,0);
  assert.equal(g.turn.needsAction(),true,id);assert.equal(p.chooseAiAction(g,0).type,'refresh',id);
  nextDraw(g,4,c=>c.type==='attack');p.runAiAction(g,0);assert.equal(g.turn.needsAction(),true,id);
  p.runAiAction(g,0);assert.equal(g.turn.state.completed,true,id);g.skipExtraActions(0);g.endTurn();
 }
});
test('priest exchange does not grant revelation healing under existing phase restriction',async()=>{
 const g=new Game({heroIds:['priest','none','none','none','none','none']});
 g.moveCard(g.deck.find(c=>c.name==='holyLight').id,{zone:'hand',playerId:0});g.startTurn(0);g.turn.state.activationDone=true;
 assert.equal(g.canRefreshUnableHand(0),true);
 await g.executeAction(0,{type:'refresh'},{choose:r=>{assert.notEqual(r.skillId,'revelation');return r.defaultValue;}});
 assert.equal(g.player(0).healing,0);assert.equal(g.turn.state.completed,false);
});
test('exchange public discard resolves a real elemental seal before returning',async()=>{
 const g=make(3);g.moveCard(g.deck.find(c=>c.name==='weakness').id,{zone:'hand',playerId:0});
 for(const p of g.players){const c=g.deck.find(c=>c.name==='holyLight');g.attachCard(c.id,p.id,{effectId:'weakness',sourcePlayerId:1});}
 const card=g.player(0).hand.find(c=>c.name==='weakness'),element=card.element;
 const seal=g.deck.find(c=>c.hasUniqueSkill(element+'Seal'));g.attachCard(seal.id,0,{effectId:element+'Seal',sourcePlayerId:1});
 assert.equal(g.canRefreshUnableHand(0),true);
 await g.executeAction(0,{type:'refresh'},{overflow:'ai'});
 assert.equal(g.player(0).getStatus(element+'Seal').length,0);assert.equal(g.pendingRuleEvents.length,0);
 assert.ok(g.log.some(s=>s.includes('受到3点法术伤害')));assert.equal(g.turn.state.completed,false);
});
