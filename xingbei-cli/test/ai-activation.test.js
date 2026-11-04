import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/engine.js';
import { getPolicy } from '../src/ai/versions.js';
const current=getPolicy('v1.17.0-preview.1');
function setup(hero,elements=[]) {
 const g=new Game({playerHeroId:hero,seed:1}).setup();
 for(const card of [...g.player(0).hand])g.moveCard(card.id,{zone:'outside'});
 for(const element of elements){const card=g.deck.find(c=>c.type==='attack'&&c.elements.includes(element));g.moveCard(card.id,{zone:'hand',playerId:0});}
 g.startTurn(0);
 return g;
}
test('activation compares shadow and fire follow-up against special actions without looking at future cards',()=>{
 const g=setup('magicSwordsman',['wind','fire']);
 const ranked=current.rankAiActions(g,0),action=ranked[0].action;
 assert.equal(action.type,'activate');assert.equal(action.plan.skillId,'shadowGathering');
 assert.equal(g.player(0).hand[action.plan.action.index].elements[0],'wind');
 assert.ok(ranked.some(e=>e.action.type==='purchase'));
 const last=g.deck.at(-1);g.moveCard(last.id,{zone:'outside'});g.moveCard(last.id,{zone:'deck'});
 const other=g.deck[0];g.moveCard(other.id,{zone:'outside'});g.moveCard(other.id,{zone:'deck'});
 assert.deepEqual(current.rankAiActions(g,0),ranked);
 const executed=[];while(g.turn.needsAction() && executed.length<5)executed.push(current.runAiAction(g,0,{autoRespond:false}).type);
 assert.deepEqual(executed,['play','play']);assert.equal(g.turn.state.attackCount,2);
});
test('inquisitor planned spell keeps its sole energy; actual post-activation hand is ranked afresh',()=>{
 const g=setup('inquisitor');g.player(0).energy.crystal=1;g.player(0).hero.state.rulings=2;
 const entries=current.rankAiActions(g,0),activation=entries.find(e=>e.action.type==='activate');
 assert.ok(activation);assert.equal(activation.action.plan.action.skillId,'divineSpur');assert.equal(activation.action.plan.skillId,null);
 g.turn.state.activationDone=true;g.turn.state.phase='activation';g.turn.state.activationPlan=activation.action.plan;
 assert.equal(current.chooseAiRuleDecision({type:'skillChoice',playerId:0,skillId:'adjudicate',choices:[{value:true},{value:false}]},g),false);
 // The plan is not an action command: after the actual draw, all new legal cards compete.
 const card=g.deck.find(c=>c.type==='attack');g.moveCard(card.id,{zone:'hand',playerId:0});g.turn.state.phase='actionPhaseStart';
 const fresh=current.rankAiActions(g,0);
 assert.ok(fresh.some(e=>e.action.type==='play'));assert.ok(fresh.every(e=>e.action.type!=='activate'));
});
