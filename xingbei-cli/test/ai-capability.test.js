import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/engine.js';
import {captureObservation,observationView} from '../src/ai/observation.js';
import {getPolicy} from '../src/ai/versions.js';
import {stateOf,clone,handValue,specialtyOptionValue} from '../src/ai/economy-capability1/model.js';
import {stateOf as oldState,handValue as oldHandValue} from '../src/ai/v1.3-economy4/model.js';
const make=(hero,enabled=true)=>new Game({seed:73,heroIds:[hero,'marksman','guardianAngel','none','none','none'],heroRules:enabled});
const take=(g,skill)=>g.moveCard(g.deck.find(c=>c.hasUniqueSkill(skill)).id,{zone:'hand',playerId:0});
const model=g=>stateOf(observationView(captureObservation(g,0)),0);

test('priest receives no unusable marked-card bonus and no imaginary skilled-recipient bonus',()=>{
 const g=make('priest');take(g,'precisionShot');take(g,'flashTrap');take(g,'angelWall');
 const view=observationView(captureObservation(g,0)),s=stateOf(view,0),old=oldState(view,0);
 assert.equal(specialtyOptionValue(s,s.players[0]),0);
 assert.equal(oldHandValue(old,old.players[0])-handValue(s,s.players[0]),6);
 assert.ok(g.players.some(p=>p.hero.id==='marksman'));assert.ok(g.players.some(p=>p.hero.id==='guardianAngel'));
});

test('marksman needs enabled owned skill and matching card; precision offer reaches real engine',async()=>{
 const g=make('marksman'),precision=take(g,'precisionShot');take(g,'flashTrap');g.startTurn(0);
 const s=model(g);assert.equal(specialtyOptionValue(s,s.players[0]),4);
 assert.ok(g.legalSkillActions(0).some(a=>a.skillId==='flashTrap'));
 const offered=[];await g.executeAction(0,{type:'play',index:g.player(0).hand.indexOf(precision),targetId:1},{choose:r=>{offered.push(r.skillId);return r.defaultValue;},chooseResponse:()=>null});
 assert.ok(offered.includes('precisionShot'));
 const disabled=make('marksman',false);take(disabled,'precisionShot');take(disabled,'flashTrap');
 assert.equal(specialtyOptionValue(model(disabled),model(disabled).players[0]),0);
 const stripped=make('marksman');take(stripped,'precisionShot');stripped.player(0).hero.removeSkill('precisionShot');
 assert.equal(specialtyOptionValue(model(stripped),model(stripped).players[0]),0);
 const copy=clone(s);copy.players[0].hand=copy.players[0].hand.filter(c=>c.id===precision.id);copy.players[0].hand[0].type='spell';
 assert.equal(specialtyOptionValue(copy,copy.players[0]),0);assert.equal(specialtyOptionValue(s,s.players[0]),4);
});

test('angel wall requires a marked card, owned skill and an unshielded target in the modeled branch',async()=>{
 const g=make('guardianAngel'),wall=take(g,'angelWall');g.startTurn(0);
 assert.equal(specialtyOptionValue(model(g),model(g).players[0]),2);
 for(const p of g.players)g.attachCard(g.deck.find(c=>c.name==='holyShield'||c.type==='attack').id,p.id,{effectId:'holyShield'});
 const blocked=model(g);assert.equal(specialtyOptionValue(blocked,blocked.players[0]),0);
 assert.ok(!g.legalSkillActions(0).some(a=>a.skillId==='angelWall'));
 g.removeEffect(g.player(3).getStatus('holyShield')[0].id);
 const open=model(g);assert.equal(specialtyOptionValue(open,open.players[0]),2);
 await g.executeAction(0,{type:'skill',skillId:'angelWall',cardIds:[wall.id],targetIds:[3]});
 assert.equal(g.player(3).getStatus('holyShield')[0].id,wall.id);
 const without=clone(open);without.players[0].hand=[];without.players[0].count=0;
 assert.equal(specialtyOptionValue(without,without.players[0]),0);
 assert.equal(specialtyOptionValue(open,open.players[0]),2);
});

test('new candidate rank and trace remain invariant to other hands and future deck order',()=>{
 const g=new Game({seed:21}).setup();g.startTurn(0);const p=getPolicy('experimental/economy-capability-1');
 const ranks=p.rankAiActions(g,0),trace=p.traceDecision(g,0),history=structuredClone(g.publicHistory.events),sequence=g.publicHistory.sequence;
 const counts=g.players.map(p=>p.hand.length);
 for(let id=1;id<6;id++)for(const c of [...g.player(id).hand])g.moveCard(c.id,{zone:'deck'});
 for(const c of [...g.deck].reverse())g.moveCard(c.id,{zone:'deck'});
 for(let id=1;id<6;id++)for(let j=0;j<counts[id];j++)g.moveCard(g.deck[0].id,{zone:'hand',playerId:id});
 g.publicHistory.events=history;g.publicHistory.sequence=sequence;
 assert.deepEqual(p.rankAiActions(g,0),ranks);assert.deepEqual(p.traceDecision(g,0),trace);
 assert.deepEqual(p.replayTrace(trace),trace.candidates);
 assert.equal(getPolicy('v1.3').chooseAiAction(g,0).type==='pass',false);
});
