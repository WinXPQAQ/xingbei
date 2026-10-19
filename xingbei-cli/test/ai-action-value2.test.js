import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {Game} from '../src/engine.js';import {captureObservation,observationView} from '../src/ai/observation.js';import {getPolicy} from '../src/ai/versions.js';
import {stateOf,clone,energyPlan,handValue,nextTurnRisk,components} from '../src/ai/action-value2/model.js';import {actionPlan,explain} from '../src/ai/action-value2/planner.js';
import {distribution,chainChance,sharedGemOption,spellBacklog} from '../src/ai/action-value1/projection.js';
const cases=JSON.parse(fs.readFileSync(new URL('../artifacts/ai/mandatory-action/negative-cases.json',import.meta.url)));
const policy=getPolicy('experimental/action-value-2'),take=(g,id,f)=>g.moveCard(g.deck.find(f).id,{zone:'hand',playerId:id});
const model=(g,id=0)=>stateOf(observationView(captureObservation(g,id,{actions:true})),id);
test('original wind energy remains stored in all first-attack branches; no invented forced sword shadow cost',()=>{
 const s=stateOf(observationView(cases[0].observation),2),before=energyPlan(s,s.players[2]);
 for(const sequence of [false,true])for(const b of actionPlan(s,2,{type:'play',index:1,targetId:0},{sequence}).branches){assert.deepEqual(b.state.players[2].energy,{gem:1,crystal:0});assert.equal(energyPlan(b.state,b.state.players[2]),before);}
 const p=s.players[2],v=energyPlan(s,p);p.energy.gem++;assert.ok(energyPlan(s,p)-v<v); // diminishing second reserve
});
test('public prior is normalized, buys produce expected defenses and real three-attack possibilities without playable invented cards',()=>{
 const s=stateOf(observationView(cases[0].observation),2),p=s.players[2];
 for(const key of Object.keys(s.prior.counts))assert.ok(Math.abs(distribution(s.prior,key,3).reduce((a,b)=>a+b,0)-1)<1e-10);
 const after=actionPlan(s,2,{type:'purchase'}).branches[0].state;
 assert.equal(after.players[2].hand.length,3);assert.equal(after.players[2].count,6);
 assert.ok(chainChance(s.prior,3,2,0,3)>0);assert.equal(chainChance(s.prior,0,2,0,3),0);
 const blind=clone(after);blind.draws=false;blind.projection=false;assert.ok(nextTurnRisk(after)>nextTurnRisk(blind));
});
test('wind ordinary spell backlog differs from sealer spell-then-attack; support card retains meaningful value',()=>{
 const g=new Game({heroIds:['windSwordmaster','none','none','none','none','none']});take(g,0,c=>c.name==='magicBullet');take(g,0,c=>c.type==='attack');g.startTurn(0);
 const s=model(g),without=clone(s);without.tempo=false;assert.ok(handValue(s,s.players[0])<handValue(without,without.players[0]));
 s.players[0].hero='sealer';without.players[0].hero='sealer';assert.equal(handValue(s,s.players[0]),handValue(without,without.players[0]));
 const h=new Game({heroIds:['windSwordmaster','none','none','none','none','none']});take(h,0,c=>c.name==='holyShield');for(let i=0;i<6;i++)take(h,3,c=>c.type==='attack');h.startTurn(0);
 const a=actionPlan(model(h),0,{type:'play',index:0,targetId:3});assert.ok(a.branches[0].state.players[3].effects.some(e=>e.name==='holyShield'));assert.ok(explain(model(h),a).parts.effects>0);
});
test('gem allocation depends on public unmet teammate need and reverses when already supplied',()=>{
 const s=stateOf(observationView(cases[0].observation),2);assert.ok(sharedGemOption(s,'blue')>0);
 const supplied=clone(s);supplied.players[1].energy.gem=1;assert.equal(sharedGemOption(supplied,'blue'),0);
 const crystal=actionPlan(s,2,{type:'refine',stones:{gem:0,crystal:1}}).score,gem=actionPlan(s,2,{type:'refine',stones:{gem:1,crystal:0}}).score;assert.ok(crystal>gem);
});
test('sealer explanation splits first spell and optional attack and reconciles without treating entire path as spell cost',()=>{
 const c=cases[2],s=stateOf(observationView(c.observation),c.actorId),a=c.ranked.find(r=>r.action.type==='play'&&s.players[c.actorId].hand[r.action.index]?.name==='magicBullet').action;
 const full=actionPlan(s,c.actorId,a),single=actionPlan(s,c.actorId,a,{sequence:false}),e=explain(s,full);
 for(const key of Object.keys(e.parts))assert.ok(Math.abs(e.parts[key]-e.primaryParts[key]-e.continuationParts[key])<1e-8);
 assert.ok(full.score>=single.score-1e-8);assert.ok(e.continuationParts.ownHand<0);assert.ok(full.search.used<=full.search.limit);
});
test('real earth lethal wins; optional storm art applies only against shield and does not consume energy',async()=>{
 const g=new Game({heroIds:['windSwordmaster','none','none','none','none','none']});const earth=take(g,0,c=>c.type==='attack'&&c.uniqueSkills.includes('stormArt'));
 for(let i=0;i<6;i++)take(g,1,c=>c.type==='attack');g.teams.blue.morale=1;g.player(0).energy.gem=1;g.startTurn(0);
 const ranks=policy.rankAiActions(g,0);assert.equal(ranks[0].action.type,'play');
 await g.executeAction(0,{type:'play',index:0,targetId:1},{chooseResponse:()=>null,choose:r=>r.type==='skillChoice'?false:r.defaultValue,overflow:'ai'});assert.equal(g.winner,'red');assert.equal(g.player(0).energy.gem,1);
 const h=new Game({heroIds:['windSwordmaster','none','none','none','none','none']});take(h,0,c=>c.id===earth.id);const shield=h.deck.find(c=>c.name==='holyShield');h.attachCard(shield.id,1,{effectId:'holyShield',sourcePlayerId:1});h.startTurn(0);let offered=false;
 await h.executeAction(0,{type:'play',index:0,targetId:1},{chooseResponse:()=>null,choose:r=>{if(r.skillId==='stormArt'){offered=true;return true;}return r.defaultValue;}});assert.ok(offered);assert.equal(h.player(1).hand.length,2);
});
test('real purchase at low morale can lose to incoming damage, and public risk decreases with safer morale/defense',async()=>{
 const g=new Game({heroIds:Array(6).fill('none')});for(let i=0;i<3;i++)take(g,0,c=>c.name==='weakness');for(const id of [1,2,5])for(let i=0;i<2;i++)take(g,id,c=>c.type==='attack');g.teams.red.morale=1;g.startTurn(0);
 const s=model(g),b=actionPlan(s,0,{type:'purchase'}).branches[0].state;assert.ok(nextTurnRisk(b)<0);
 assert.notEqual(policy.chooseAiAction(g,0).type,'purchase');const safe=clone(b);safe.teams.red.morale=15;assert.ok(components(safe).nextTurnRisk+components(safe).routeRisk>components(b).nextTurnRisk+components(b).routeRisk);
 await g.executeAction(0,{type:'purchase'});g.endTurn();g.startTurn(1);await g.executeAction(1,{type:'play',index:0,targetId:0},{chooseResponse:()=>null,overflow:'ai'});assert.equal(g.winner,'blue');
});
test('ordinary action candidates cannot pass; optional extra remains passable',async()=>{
 const c=cases[0],rank=policy.replayTrace({version:'experimental/action-value-2',observation:c.observation});assert.ok(rank.every(r=>r.action.type!=='pass'));
 const g=new Game({heroIds:Array(6).fill('none')});take(g,0,c=>c.type==='attack');g.startTurn(0);await g.executeAction(0,{type:'play',index:0,targetId:1});g.turn.addAttackAction({sourceSkillId:'test'});assert.equal(policy.chooseAiAction(g,0).type,'pass');
});

test('joint draw categories do not invent two actions from one unknown card',()=>{
 const prior={size:2,counts:{attack:1,slow:1}};assert.equal(spellBacklog(prior,1,0,0),0);assert.equal(spellBacklog(prior,2,0,0),1.3);
});

test('unknown own attack demand and supplied own gem reverse shared allocation value',()=>{
 const g=new Game({heroIds:['berserker','none','none','none','none','none']});g.addStones('red','gem',1);g.startTurn(0);const s=model(g);assert.equal(sharedGemOption(s,'red'),0);s.players[0].count=3;assert.ok(sharedGemOption(s,'red')>0);s.players[0].energy.gem=1;assert.equal(sharedGemOption(s,'red'),0);
});
