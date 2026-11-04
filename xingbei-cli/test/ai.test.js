import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/engine.js';
import { chooseAiAction, runAiAction } from '../src/ai.js';
import { captureObservation } from '../src/ai/observation.js';
import { actionCandidates } from '../training/candidates.mjs';

test('current AI uses legal routes and completes actions with card conservation',()=>{
 const game=new Game({seed:123}).setup();
 for(let turn=0;turn<24&&!game.winner;turn++){
  const id=game.current;game.startTurn(id,{ai:true});
  let steps=0;
  while(game.turn.needsAction()){
   assert.ok(++steps<30,'action loop must make progress');
   const chosen=chooseAiAction(game,id),command=chosen.type==='activate'?{type:'activate'}:chosen;
   assert.ok(actionCandidates(game,id).some(c=>JSON.stringify(c)===JSON.stringify(command)));
   runAiAction(game,id);game.assertCardLocations();
  }
  if(!game.winner)game.endTurn({ai:true});
 }
});

test('current AI decision and observation ignore hidden hands and future deck order',()=>{
 const game=new Game({seed:57}).setup();game.startTurn(0);
 const observation=captureObservation(game,0,{actions:true,activation:true}),decision=chooseAiAction(game,0);
 const history=structuredClone(game.publicHistory);
 for(const p of game.players.slice(1)){
  const count=p.hand.length;
  for(const c of [...p.hand])game.moveCard(c.id,{zone:'deck'});
  for(let i=0;i<count;i++)game.moveCard(game.deck[0].id,{zone:'hand',playerId:p.id});
 }
 const card=game.deck[0];game.moveCard(card.id,{zone:'outside'});game.moveCard(card.id,{zone:'deck'});
 // Counterfactual hidden replacement, not additional publicly observed moves.
 Object.assign(game.publicHistory,history);
 assert.deepEqual(captureObservation(game,0,{actions:true,activation:true}),observation);
 assert.deepEqual(chooseAiAction(game,0),decision);
});
