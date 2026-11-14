import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/engine.js';
import { chooseAiAction, runAiAction } from '../src/ai.js';
import { estimateAllHeroCapabilities, CAPABILITY_HERO_IDS } from '../src/ai/hero-capabilities.js';
import { stateOf } from '../src/heroes/shared/ai/base/model.js';
import { HERO_DEFINITIONS } from '../src/hero.js';
import { captureObservation, observationView } from '../src/ai/observation.js';
import { actionCandidates } from '../training/candidates.mjs';
import { cardScore as recipientCardScore } from '../src/heroes/shared/ai/wave-three/cards.js';
import { getPolicy } from '../src/ai/versions.js';
import { AI_POLICY_VERSION } from '../src/ai.js';
import { cheapCards } from '../src/heroes/shared/ai/decisions.js';

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
 const capabilities=()=>estimateAllHeroCapabilities(stateOf(observationView(captureObservation(game,0)),0));
 const beforeCapabilities=capabilities();
 assert.deepEqual([...CAPABILITY_HERO_IDS].sort(),Object.keys(HERO_DEFINITIONS).sort());
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
 assert.deepEqual(capabilities(),beforeCapabilities);
});

test('recipient card values support every hero without inspecting hidden covered cards',()=>{
 for(const heroId of Object.keys(HERO_DEFINITIONS)){
  const game=new Game({seed:57,heroIds:['witchHunter',heroId,'berserker','marksman','guardianAngel','priest']}).setup();
  const covered=game.player(1).hand[0];
  game.moveCard(covered.id,{zone:'covered',playerId:1});
  const before=captureObservation(game,0);
  const values=observation=>{
   const view=observationView(observation);
   return view.player(0).hand.map(card=>recipientCardScore(view,1,card));
  };
  const scores=values(before);
  assert.ok(scores.every(Number.isFinite),`${heroId} recipient scores`);
  const replacement=game.deck[0],history=structuredClone(game.publicHistory);
  game.moveCard(covered.id,{zone:'deck'});
  game.moveCard(replacement.id,{zone:'covered',playerId:1});
  Object.assign(game.publicHistory,history);
  const after=captureObservation(game,0);
  assert.deepEqual(after,before,`${heroId} covered visibility`);
  assert.deepEqual(values(after),scores,`${heroId} recipient score privacy`);
 }
});

test('additional holy lights lose retention value and discard costs include duplicates', () => {
  const policy = getPolicy(AI_POLICY_VERSION);
  for (const heroId of ['heretic', 'fighter', 'magicLancer', 'azureFlameWitch', 'berserker']) {
    const game = new Game({ heroIds: [heroId, 'none', 'none', 'none', 'none', 'none'], seed: 123 });
    const player = game.player(0);
    for (const name of [...Array(5).fill('holyLight'), 'waterStrike'])
      game.moveCard(game.deck.find(card => card.name === name).id, { zone: 'hand', playerId: 0 });
    const lights = player.hand.slice(0, 5);
    const values = lights.map((card, index) => recipientCardScore(game, 0, card, lights.slice(0, index)));
    assert.ok(values.every((value, index) => !index || value < values[index - 1]));
    assert.ok(values[4] < recipientCardScore(game, 0, player.hand[5]));
    assert.ok(policy.chooseAiDiscard(game, 0, 1).every(index => player.hand[index].name === 'holyLight'), heroId);
    const discarded = cheapCards({ game, id: 0, source: player, request: { valid: [0, 1, 2, 3, 4, 5], count: 1 } }, { cardScore: recipientCardScore });
    assert.equal(player.hand[discarded[0]].name, 'holyLight');
  }
});

test('terminal forecast accepts fractional expected morale without changing rule state', async()=>{
 const {terminalForecast}=await import('../src/heroes/shared/ai/base/horizon.js');
 const game=new Game({seed:17}).setup();
 const state=stateOf(game,0);
 state.teams.red.morale=2.25;state.teams.blue.morale=4.75;
 const before=JSON.stringify(state.teams);
 const score=terminalForecast(state);
 assert.ok(Number.isFinite(score));
 let expected=0;
 for(const [red,rp] of [[2,.75],[3,.25]])for(const [blue,bp] of [[4,.25],[5,.75]]) {
   const branch={...state,teams:{red:{...state.teams.red,morale:red},blue:{...state.teams.blue,morale:blue}}};
   expected+=rp*bp*terminalForecast(branch);
 }
 assert.ok(Math.abs(score-expected)<1e-9,'fractional estimate preserves the adjacent-integer mixture');
 assert.equal(JSON.stringify(state.teams),before);
 assert.equal(game.teams.red.morale,15);
});
