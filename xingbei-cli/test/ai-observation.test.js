import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/engine.js';
import {getPolicy} from '../src/ai/versions.js';
import {captureObservation,observationView} from '../src/ai/observation.js';
import {costBeliefs} from '../src/ai/v1.1/fusion.js';
import {publicBeliefs} from '../src/ai/public-history.js';
const heroes=['berserker','windSwordmaster','marksman','sealer','guardianAngel','priest'];
function outputs(g) {
  return Object.fromEntries(['v1.0','read-1','read-prior','read-off','fusion-1'].map(name=>{
    const p=getPolicy(name), own=g.player(0), r={target:own,actor:g.player(1),counterTargets:g.players.filter(p=>p.team!==own.team),valid:own.hand.map((card,index)=>({card,index})),shieldable:true};
    const decisions=['weakness','bindingChoice','healing','cardChoice','skillChoice','numberChoice'].map(type=>p.chooseAiRuleDecision({type,playerId:0,skillId:type==='numberChoice'?'holySword':'rend',count:1,valid:own.hand.map((_,i)=>i),choices:[0,1,2].map(value=>({value})),context:{targetId:1,amount:3}},g));
    return [name,{rank:p.rankAiActions(g,0),action:p.chooseAiAction(g,0),discard:p.chooseAiDiscard(g,0,2),response:p.chooseAiResponse(g,r),decisions,beliefs:[...publicBeliefs(observationView(captureObservation(g,0)))],costBeliefs:[...costBeliefs(observationView(captureObservation(g,0)))]}];
  }));
}
test('six heroes × three public states × three hidden permutations: identical observations and every queried decision',()=>{
 for(const hero of heroes) for(let state=0;state<3;state++) {
  const g=new Game({seed:123+state,playerHeroId:hero}).setup();
  if(state) {const seal=g.deck.find(c=>c.hasUniqueSkill('fireSeal'));g.attachCard(seal.id,0,{effectId:'fireSeal',sourcePlayerId:3});const shield=g.deck.find(c=>c.name==='holyShield');g.attachCard(shield.id,1,{effectId:'holyShield',sourcePlayerId:1});g.player(0).energy.gem=1;g.player(0).energy.crystal=2;g.player(1).healing=2;g.teams.blue.morale=3;g.startTurn(0);}
  if(state===2) {g.turn.state.attackCount=2;g.turn.state.completed=true;g.turn.state.pendingActions=[{type:'attack',element:'wind'}];g.publicHistory.append({type:'unanswered',playerId:1,elements:['fire']});}
  const observation=captureObservation(g,0,{actions:true}), expected=outputs(g);
  for(let permutation=0;permutation<3;permutation++) {
   const history=g.publicHistory, counts=g.players.slice(1).map(p=>p.hand.length);
   const before=g.players.slice(1).map(p=>p.hand.map(c=>c.id)), deckBefore=g.deck.map(c=>c.id);
   for(const p of g.players.slice(1)) for(const c of [...p.hand]) g.moveCard(c.id,{zone:'deck'});
   const order=[...g.deck].reverse();for(const c of order)g.moveCard(c.id,{zone:'deck'});
   for(let i=1;i<6;i++)for(let j=0;j<counts[i-1];j++)g.moveCard(g.deck[(j*7+permutation*11)%g.deck.length].id,{zone:'hand',playerId:i});
   // Restore exactly the visible history; rearrangement is counterfactual, not play.
   history.events=observation.publicHistory.events.map(e=>Object.freeze({...e}));history.sequence=observation.publicHistory.sequence;
   for(let i=1;i<6;i++)assert.notDeepEqual(g.player(i).hand.map(c=>c.id),before[i-1]);
   assert.notDeepEqual(g.deck.map(c=>c.id),deckBefore);
   g.assertCardLocations();assert.deepEqual(captureObservation(g,0,{actions:true}),observation);assert.deepEqual(outputs(g),expected);
  }
 }
});
test('reflection and mutation of detached view cannot expose or mutate the engine',()=>{
 const g=new Game({seed:44}).setup(), dto=captureObservation(g,0,{actions:true}), v=observationView(dto);
 assert.equal(Object.getOwnPropertyDescriptor(v.player(1),'hand').value.length,g.player(1).hand.length);
 assert.deepEqual(Object.keys(v.player(1).hand),['length']);assert.equal(Object.getOwnPropertyDescriptor(v,'deck'),undefined);
 const values=new Set();const walk=x=>{if(typeof x==='string')values.add(x);else if(x&&typeof x==='object')Object.values(x).forEach(walk);else assert.notEqual(typeof x,'function');};walk(dto);
 for(const card of [...g.deck,...g.players.slice(1).flatMap(p=>p.hand)])assert.ok(!values.has(card.id));
 const hidden=g.player(1).hand[0].id;assert.equal(v.cards.get(hidden),undefined);
 v.player(0).hand[0].name='corrupted';v.teams.red.morale=-100;assert.notEqual(g.player(0).hand[0].name,'corrupted');assert.notEqual(g.teams.red.morale,-100);
});
test('wrapped baseline decisions match frozen behavior on six hero observations',()=>{
 for(const hero of heroes)for(let seed=1;seed<=10;seed++) {
 const g=new Game({seed,playerHeroId:hero}).setup(),a=getPolicy('read-off'),b=getPolicy('v1.0');
 assert.deepEqual(a.rankAiActions(g,0).map(({action,score})=>({action,score})),b.rankAiActions(g,0).map(({action,score})=>({action,score})));
 assert.deepEqual(a.chooseAiDiscard(g,0,2),b.chooseAiDiscard(g,0,2));
 const r={target:g.player(0),actor:g.player(1),valid:g.player(0).hand.map((card,index)=>({card,index})),counterTargets:[g.player(1)],shieldable:true};assert.deepEqual(a.chooseAiResponse(g,r),b.chooseAiResponse(g,r));
 }
});

test('fusion evidence strengthens only with public acceptance cost',async()=>{
 const {costBeliefs}=await import('../src/ai/v1.1/fusion.js');
 const cheap={publicHistory:{events:[{type:'unanswered',playerId:1,elements:['fire'],acceptCost:0}]}},costly={publicHistory:{events:[{type:'unanswered',playerId:1,elements:['fire'],acceptCost:2}]}};
 assert.ok(costBeliefs(costly).get(1).fire>costBeliefs(cheap).get(1).fire);assert.ok(costBeliefs(costly).get(1).fire<1);
});
test('fusion sequence requires actual own cards, third attack or available extra resources',async()=>{
 const {attackUtility}=await import('../src/ai/v1.1/fusion.js');
 const g=new Game({seed:73,heroIds:['windSwordmaster','marksman','berserker','sealer','guardianAngel','priest']});
 const take=name=>g.moveCard(g.deck.find(c=>c.name===name&&!c.hasUniqueSkill('galeArt')).id,{zone:'hand',playerId:0});
 for(let i=0;i<6;i++)g.moveCard(g.deck[0].id,{zone:'hand',playerId:1});
 const first=take('fireStrike');take('earthStrike');take('waterStrike');g.startTurn(0);
 const utility=()=>{const v=observationView(captureObservation(g,0));const result=attackUtility(v,0,v.cards.get(first.id),1);assert.equal(new Set(result.steps).size,result.steps.length);return result;};
 assert.equal(utility().steps.length,1);
 g.player(0).energy.crystal=1;
 assert.ok(utility().steps.length<=2);
 take('windStrike');assert.equal(utility().steps.length,3);
});
test('fusion complete games: all six lineups, rule legality and card conservation',async()=>{
 const {playMatch,lineups}=await import('../tools/ai/evaluate.mjs');
 for(const lineup of Object.keys(lineups)) {const r=await playMatch({seed:17,start:0,team:'red',lineup},{candidate:'fusion-1',opponent:'v1.0'});assert.ok(r.winner);}
});

test('basic cards bearing seal effects remain removable public effects',()=>{const g=new Game({seed:9}).setup();const seal=g.deck.find(c=>c.hasUniqueSkill('fireSeal'));g.attachCard(seal.id,0,{effectId:'fireSeal',sourcePlayerId:3});assert.deepEqual(observationView(captureObservation(g,0)).player(0).getBasicEffects().map(c=>c.id),g.player(0).getBasicEffects().map(c=>c.id));});

test('covered discard hides traits from public history, ordinary public discard remains evidence',()=>{
 const g=new Game({seed:1});
 for(const covered of [true,false]) {
  const c=g.moveCard(g.deck.find(c=>c.type==='attack').id,{zone:'hand',playerId:1});
  g.discardCards(1,[c],{visibility:'public',covered});
  assert.deepEqual(g.publicHistory.events.at(-1).elements,covered?null:c.elements);
 }
});
