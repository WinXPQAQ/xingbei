import test from 'node:test';
import assert from 'node:assert/strict';
import { Game,Timing } from '../src/engine.js';
import { safeRemovalSets } from '../src/inability.js';
const ids=['magicSwordsman','beastWarrior','berserker','headMaid','priest','marksman'];
function setup(names){
 const game=new Game({heroIds:ids,seed:123}).setup();
 for(const card of [...game.player(0).hand])game.moveCard(card.id,{zone:'outside'});
 for(const name of names){const card=game.deck.find(c=>name==='attack'?c.type==='attack':c.type==='spell');game.moveCard(card.id,{zone:'hand',playerId:0});}
 game.player(0).hero.state.form='暗影';
 game.turn.state={playerId:0,activationDone:true,completed:false,actionType:null,skipped:false,phase:Timing.ACTIVATION,usedSkills:{},pendingActions:[]};
 return game;
}
test('known loss of entire hand is blocked; hidden faces never determine enemy target legality',()=>{
 const one=setup(['attack']);assert.equal(one.knownRemovalBlocked(1,0,1),true);
 const two=setup(['attack','spell']);assert.equal(two.knownRemovalBlocked(1,0,1),false);
 assert.deepEqual(safeRemovalSets(two,0,1),[[1]]);
 const iterator=two.chooseHandCards(0,1,()=>true,{preserveAction:true});
 const request=iterator.next().value;assert.deepEqual(request.validSets,[[1]]);
 assert.throws(()=>iterator.next([0]),/你将无法行动/);
 assert.equal(two.player(0).hand.length,2);
});
test('actual malicious inability records responsible side and a detached complete archive',()=>{
 const game=setup(['attack']);const card=game.player(0).hand[0];
 game.moveCard(card.id,{zone:'discard'},{visibility:'public'});
 assert.equal(game.forfeitMaliciousInability(1,'beastVigilance',0,{knownHandCount:1,removedCardId:card.id}),true);
 assert.equal(game.winner,'red');
 const record=game.inabilityArchives[0];assert.equal(record.responsiblePlayerId,1);assert.equal(record.players.length,6);
 assert.ok(record.cards.length>=150);assert.ok(record.log.some(x=>x.includes('恶意无法行动')));
 game.log.push('later');assert.ok(!record.log.includes('later'));
});
test('unlucky activation redraws until actionable without a second activation',()=>{
 const game=setup(['spell']);game.turn.state.randomActivationDraw=true;
 // Last deck card is drawn first: one further unusable spell, then an attack.
 const attack=game.deck.find(c=>c.type==='attack'), spell=game.deck.find(c=>c.type==='spell');
 game.moveCard(attack.id,{zone:'outside'});game.moveCard(spell.id,{zone:'outside'});
 game.moveCard(attack.id,{zone:'deck'});game.moveCard(spell.id,{zone:'deck'});
 const steps=game.restoreRandomInability(0);let step=steps.next();
 while(!step.done){assert.ok(['presentation'].includes(step.value.type));step=steps.next();}
 assert.equal(game.player(0).hand.length,1);assert.equal(game.player(0).hand[0].type,'attack');
 assert.equal(game.turn.state.activationDone,true);assert.equal(game.winner,null);
 assert.equal(game.log.filter(x=>x.includes('无法行动，展示')).length,2);
});

test('recorded ownership attributes an unsafe personal discard to the chooser, not the forcing hero',()=>{
 const game=setup(['attack','spell']);
 game.activeTrigger={ownerId:1,skillId:'beastVigilance'};
 // Simulate an old caller which did not request pre-filtering; post-check remains a backstop.
 const choice=game.chooseHandCards(0,1);choice.next();const selected=choice.next([0]).value;
 game.discardCards(0,selected);
 assert.equal(game.turn.state.inabilityCause.actorId,0);
 const steps=game.restoreRandomInability(0);let step=steps.next();while(!step.done)step=steps.next();
 assert.equal(game.winner,'blue');assert.equal(game.inabilityArchives[0].responsiblePlayerId,0);
});
