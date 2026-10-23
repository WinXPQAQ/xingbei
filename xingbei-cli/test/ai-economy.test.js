import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/engine.js';
import {getPolicy} from '../src/ai/versions.js';
import {AI_POLICY_VERSION} from '../src/ai.js';
import {captureObservation,observationView} from '../src/ai/observation.js';
import {stateOf,value,clone,damage,nextTurnRisk} from '../src/ai/v1.3/model.js';
import {piercingOptions,actionPlan} from '../src/ai/v1.3/planner.js';
import {SEARCH_LIMIT} from '../src/ai/v1.3/planner.js';
const p=getPolicy('experimental/economy-3');
const take=(g,id,name)=>g.moveCard(g.deck.find(typeof name==='function'?name:c=>c.name===name).id,{zone:'hand',playerId:id});
const fill=(g,id,n)=>{while(g.player(id).hand.length<n)take(g,id,c=>c.type==='attack');};
const model=(g,id=0)=>stateOf(observationView(captureObservation(g,id,{actions:true})),id);
const snapshot=g=>JSON.stringify({cards:[...g.cards.values()].map(c=>c.toJSON()),players:g.players.map(p=>({id:p.id,hand:p.hand.map(c=>c.id),healing:p.healing,energy:p.energy,hero:p.hero.state})),teams:g.teams,turn:g.turn.state,history:g.publicHistory,log:g.log});
test('wind search has a deterministic expansion budget even with full public history',()=>{
 const g=new Game({seed:19,playerHeroId:'windSwordmaster'});for(let i=0;i<6;i++)take(g,0,'windStrike');for(const id of [1,2,5])fill(g,id,6);g.player(0).energy.crystal=2;g.startTurn(0);
 for(let i=0;i<300;i++)g.publicHistory.append({type:'turn',playerId:i%6});
 const ranks=p.rankAiActions(g,0);assert.equal(SEARCH_LIMIT,128);assert.ok(ranks.every(r=>(r.explanation.search?.used??0)<=SEARCH_LIMIT));
 assert.deepEqual(p.rankAiActions(g,0),ranks);
});
test('shared planning history is deeply read-only and confined to one observation',()=>{
 const g=new Game({seed:21}).setup();g.publicHistory.append({type:'unanswered',playerId:1,elements:['fire'],acceptCost:2});
 const s=model(g),branch=clone(s),fresh=model(g),event=s.history.at(-1);
 assert.equal(branch.history,s.history);assert.equal(branch.beliefs,s.beliefs);assert.notEqual(fresh.history,s.history);
 assert.throws(()=>event.elements.push('water'),TypeError);branch.players[0].healing=99;assert.notEqual(s.players[0].healing,99);assert.notEqual(g.player(0).healing,99);
});

test('historical economy-3 remains opt-in; high-probability attack can lose to passing',()=>{
 assert.equal(AI_POLICY_VERSION,'v1.7.0-preview.2');
 const g=new Game({seed:7,playerHeroId:'sealer'});take(g,0,'darkStrike');g.addStones('red','gem',5);g.startTurn(0);
 g.turn.state.completed=true;g.turn.state.pendingActions=[{type:'attack',sourceSkillId:'spellExcitation'}];
 const ranks=p.rankAiActions(g,0);assert.equal(ranks[0].action.type,'pass');assert.ok(ranks.filter(r=>r.action.type==='play').every(r=>r.score<0));
});
test('piercing separates shedding benefit from harmful opponent replenishment; low burden declines',()=>{
 const g=new Game({seed:8,playerHeroId:'marksman'});for(let i=0;i<3;i++)take(g,0,'magicBullet');for(let i=0;i<3;i++)take(g,0,'fireStrike');fill(g,1,1);
 const s=model(g),best=piercingOptions(s,0,1)[0];assert.ok(best.card);assert.ok(best.parts.ownHand>0);assert.ok(best.parts.otherHands<0);assert.ok(best.score>0);
 for(const c of [...g.player(0).hand].slice(3))g.moveCard(c.id,{zone:'discard'});
 assert.equal(piercingOptions(model(g),0,1)[0].card,null);
});
test('seal cost and removal both appear; covered sacredDomain costs do not trigger seals',()=>{
 const g=new Game({seed:9,playerHeroId:'priest'});const c=take(g,0,c=>c.type==='spell'&&c.elements.includes('fire'));take(g,0,'magicBullet');fill(g,1,3);g.player(0).energy.crystal=1;g.player(0).healing=1;
 const seal=g.deck.find(c=>c.hasUniqueSkill('fireSeal'));g.attachCard(seal.id,0,{effectId:'fireSeal',sourcePlayerId:1});
 const s=model(g),r=actionPlan(s,0,{type:'skill',skillId:'sacredDomain',mode:'damage',cardIds:s.players[0].hand.map(c=>c.id),targetIds:[1]});
 assert.ok(r.branches[0].state.players[0].effects.some(e=>e.name==='fireSeal'));assert.equal(r.branches[0].state.players[0].count,0);
 const attack=new Game({seed:10,playerHeroId:'marksman'});const fire=take(attack,0,'fireStrike');fill(attack,0,6);fill(attack,1,3);
 const before=p.rankAiActions(attack,0).find(r=>r.action.type==='play'&&r.action.index===0&&r.action.targetId===1);
 const seal2=attack.deck.find(c=>c.hasUniqueSkill('fireSeal'));attack.attachCard(seal2.id,0,{effectId:'fireSeal',sourcePlayerId:1});
 const after=p.rankAiActions(attack,0).find(r=>r.action.type==='play'&&r.action.index===0&&r.action.targetId===1);
 assert.notEqual(before.score,after.score);assert.ok(after.explanation.parts.effects>0);assert.ok(after.explanation.parts.morale<0);
});
test('public next-turn risk values holding defense, public seat order and enemy preparation',()=>{
 const g=new Game({seed:11,playerHeroId:'marksman'});fill(g,0,6);fill(g,1,6);fill(g,2,6);fill(g,5,6);
 const s=model(g),safe=clone(s);safe.players[0].healing=3;assert.ok(nextTurnRisk(s)<nextTurnRisk(safe));
 const protectedState=clone(s);protectedState.players[0].hand[0].name='holyLight';assert.ok(nextTurnRisk(protectedState)>nextTurnRisk(s));
 const imminent=clone(s);imminent.current=5;assert.equal(nextTurnRisk(imminent),0);assert.ok(nextTurnRisk(s)<0);
});
test('positive local state gain can be reversed by next-turn survival risk',()=>{
 const g=new Game({seed:19,playerHeroId:'marksman'});for(let i=0;i<6;i++)take(g,0,c=>c.name==='fireStrike'&&!c.hasUniqueSkill('precisionShot')&&!c.hasUniqueSkill('flashTrap'));
 for(const id of [1,2,5])fill(g,id,3);g.player(0).healing=2;g.teams.red.morale=1;const seal=g.deck.find(c=>c.hasUniqueSkill('fireSeal'));g.attachCard(seal.id,0,{effectId:'fireSeal',sourcePlayerId:1});
 const ranks=p.rankAiActions(g,0),attack=ranks.find(r=>r.action.type==='play'&&r.action.targetId===1),parts=attack.explanation.parts;
 assert.ok(attack.score-parts.nextTurnRisk-parts.otherTurnRisk>0);assert.ok(attack.score<0);assert.notEqual(ranks[0].action.type,'pass');
});
test('gift valuation uses public seal and full completed waterPower effect; trace never mutates overflow',async()=>{
 const g=new Game({seed:12,heroIds:['priest','berserker','sealer','marksman','guardianAngel','windSwordmaster']});
 const water=take(g,0,c=>c.type==='spell'&&c.elements.includes('water')),fire=take(g,0,'fireStrike');fill(g,3,5);g.player(0).healing=1;g.player(3).healing=1;
 const before=p.giftScore(g,0,3,fire),seal=g.deck.find(c=>c.hasUniqueSkill('fireSeal'));g.attachCard(seal.id,3,{effectId:'fireSeal',sourcePlayerId:1});assert.ok(p.giftScore(g,0,3,fire)<before);
 let request;g.startTurn(0);await g.executeAction(0,{type:'skill',skillId:'waterPower',cardIds:[water.id],targetIds:[3]},{choose:r=>{if(r.purpose==='give')request=r;return p.chooseAiRuleDecision(r,g);},overflow:'ai'});
 assert.equal(request.skillId,'waterPower');assert.equal(g.player(0).hand.length,0);assert.equal(g.player(3).hand.length,6);assert.equal(g.player(3).healing,2);
 const h=new Game({seed:13}).setup();fill(h,0,7);const saved=snapshot(h);p.traceDecision(h,0,{type:'overflow',player:h.player(0)});assert.equal(snapshot(h),saved);
});
test('real precision attack resolves without cloning functions; card conservation',async()=>{
 const g=new Game({seed:14,playerHeroId:'marksman'});const earth=take(g,0,c=>c.hasUniqueSkill('precisionShot'));fill(g,1,6);g.startTurn(0);
 await g.executeAction(0,{type:'play',index:0,targetId:1},{choose:r=>p.chooseAiRuleDecision(r,g),chooseResponse:r=>p.chooseAiResponse(g,r),overflow:'ai'});g.assertCardLocations();assert.ok(!g.player(0).hand.includes(earth));
});
test('public guardian energy prevents false spell terminal, but not attack/direct-draw overflow',async()=>{
 const g=new Game({seed:16,heroIds:['marksman','guardianAngel','berserker','priest','sealer','windSwordmaster']});fill(g,1,5);g.player(1).energy.crystal=1;g.teams.blue.morale=1;
 const s=model(g),attack=clone(s),direct=clone(s);damage(s,1,2,'spell');damage(attack,1,2,'attack');
 assert.equal(s.teams.blue.morale,1);assert.equal(s.players[1].energy.crystal,0);assert.equal(attack.teams.blue.morale,0);
 g.automaticDecision=r=>p.chooseAiRuleDecision(r,g);g.damage(1,2,{damageType:'spell',sourceId:0,overflow:'ai'});
 assert.equal(g.teams.blue.morale,s.teams.blue.morale);assert.equal(g.player(1).energy.crystal,0);
});
test('sealed water payment still transfers an anonymous newly drawn card in the plan',async()=>{
 const g=new Game({seed:17,playerHeroId:'priest'}),water=take(g,0,'waterStrike');const seal=g.deck.find(c=>c.hasUniqueSkill('waterSeal'));g.attachCard(seal.id,0,{effectId:'waterSeal',sourcePlayerId:1});
 const action={type:'skill',skillId:'waterPower',cardIds:[water.id],targetIds:[3]},plan=actionPlan(model(g),0,action);
 assert.equal(plan.branches[0].state.players[0].count,2);assert.equal(plan.branches[0].state.players[3].count,1);
 g.startTurn(0);await g.executeAction(0,action,{choose:r=>p.chooseAiRuleDecision(r,g),overflow:'ai'});assert.equal(g.player(0).hand.length,2);assert.equal(g.player(3).hand.length,1);
});
test('magic bullet cannot kill through a public shield; genuine no-response engine agrees',async()=>{
 const g=new Game({seed:18,heroRules:false});take(g,0,'magicBullet');fill(g,1,6);g.teams.blue.morale=1;
 const shield=g.deck.find(c=>c.name==='holyShield');g.attachCard(shield.id,1,{effectId:'holyShield',sourcePlayerId:1});
 const plan=actionPlan(model(g),0,{type:'play',index:0,targetId:1});
 assert.ok(plan.branches.every(b=>b.state.teams.blue.morale===1));
 await g.executeAction(0,{type:'play',index:0,targetId:1},{chooseResponse:()=>null,overflow:'ai'});
 assert.equal(g.teams.blue.morale,1);assert.equal(g.player(1).getStatus('holyShield').length,0);assert.equal(g.winner,null);
});
test('sealBreaking real effect request identifies transfer into hand and preserves trace replay',async()=>{
 const g=new Game({seed:19,playerHeroId:'sealer'});g.player(0).energy.crystal=1;
 const effect=g.deck.find(c=>c.name==='poison');g.attachCard(effect.id,1,{effectId:'poison',sourcePlayerId:0});let seen=false;
 g.startTurn(0);await g.executeAction(0,{type:'skill',skillId:'sealBreaking',cardIds:[],targetIds:[1]},{choose:r=>{if(r.type==='effectChoice'){seen=true;assert.equal(r.skillId,'sealBreaking');const trace=p.traceDecision(g,0,r);assert.deepEqual(p.replayTrace(trace),trace.decision);}return p.chooseAiRuleDecision(r,g);},overflow:'ai'});
 assert.ok(seen);assert.ok(g.player(0).hand.some(c=>c.id===effect.id));
});
test('six-seat hidden permutations preserve action/nested traces for candidate and ablations',()=>{
 for(const id of [0,1,2,3,4,5]) {
  const g=new Game({seed:31+id}).setup();g.current=id;
  const requests=[null,{type:'cardChoice',playerId:id,skillId:'piercingShot',count:1,valid:g.player(id).hand.map((c,i)=>c.type==='spell'?i:null).filter(i=>i!==null),context:{targetId:g.players.find(p=>p.team!==g.player(id).team).id}},
   {type:'cardChoice',playerId:id,purpose:'give',skillId:'waterPower',recipientId:g.players.find(p=>p.team===g.player(id).team&&p.id!==id).id,count:1,valid:[0,1,2,3]},
   {type:'healing',playerId:id,choices:[{value:0}],context:{amount:2}},
   {type:'skillChoice',playerId:id,skillId:'spellExcitation'},
   {type:'response',target:g.player(id),actor:g.players.find(p=>p.team!==g.player(id).team),valid:g.player(id).hand.filter(c=>c.name==='holyLight').map(c=>({card:c,index:g.player(id).hand.indexOf(c)})),counterTargets:[],shieldable:true}];
  const names=['experimental/economy-3','experimental/economy-3-no-sequence','experimental/economy-3-no-hand'];
  const before=snapshot(g),expected=names.map(n=>requests.map(r=>getPolicy(n).traceDecision(g,id,r)));assert.equal(snapshot(g),before);
  expected.forEach((traces,i)=>traces.forEach(t=>assert.deepEqual(getPolicy(names[i]).replayTrace(JSON.parse(JSON.stringify(t))),t.request?t.decision:t.candidates)));
  const observation=captureObservation(g,id,{actions:true}),counts=g.players.map(p=>p.hand.length);
  for(const q of g.players.filter(p=>p.id!==id))for(const c of [...q.hand])g.moveCard(c.id,{zone:'deck'});
  for(const c of [...g.deck].reverse())g.moveCard(c.id,{zone:'deck'});
  for(const q of g.players.filter(p=>p.id!==id))for(let n=0;n<counts[q.id];n++)g.moveCard(g.deck[0].id,{zone:'hand',playerId:q.id});
  g.publicHistory.events=observation.publicHistory.events;g.publicHistory.sequence=observation.publicHistory.sequence;
  assert.deepEqual(captureObservation(g,id,{actions:true}),observation);
  assert.deepEqual(names.map(n=>requests.map(r=>getPolicy(n).traceDecision(g,id,r))),expected);
  const serialized=JSON.stringify(expected);for(const c of [...g.deck,...g.players.filter(q=>q.id!==id).flatMap(q=>q.hand)])assert.ok(!serialized.includes(`"${c.id}"`));
 }
});
