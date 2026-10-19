import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/engine.js';
import {getPolicy} from '../src/ai/versions.js';

// Reach requests through engine resolution, rather than inventing request shapes.
// Optional offers may be accepted explicitly to exercise a reachable branch;
// every candidate answer is checked before that fixture override is applied.
const policy=()=>getPolicy('experimental/economy-3');
const make=hero=>new Game({seed:93,shuffleDeck:false,heroIds:[hero,'none','none','none','none','none']});
const take=(g,id,predicate)=>{const c=g.deck.find(typeof predicate==='string'?c=>c.name===predicate:predicate);assert.ok(c,'fixture card exists');return g.moveCard(c.id,{zone:'hand',playerId:id});};
const fill=(g,id,n)=>{while(g.player(id).hand.length<n)take(g,id,c=>c.type==='attack');};
function harness(g,overrides={}) {
 const requests=[];
 const choose=r=>{
  if(r.type==='overflow')return g.resolveOverflowWithDecisions(r.player.id,policy().chooseAiDiscard(g,r.player.id,r.player.hand.length-r.player.handLimit),options);
  const answer=r.type==='response'?policy().chooseAiResponse(g,r):policy().chooseAiRuleDecision(r,g);
  requests.push({type:r.type,skillId:r.skillId,purpose:r.purpose,answer,request:r});
  if(r.type==='skillChoice')assert.equal(typeof answer,'boolean');
  else if(r.type==='cardChoice'){
   if(answer===null)assert.ok(r.optional);
   else {assert.equal(answer.length,r.count);assert.equal(new Set(answer).size,answer.length);assert.ok(answer.every(i=>r.valid.includes(i)));}
  }else if(r.type==='response'){
   if(answer!==null){const picked=r.valid.find(v=>v.index===answer.index);assert.ok(picked);if(picked.card.type==='attack')assert.ok(r.counterTargets.some(t=>t.id===answer.targetId));}
  }else if(r.choices)assert.ok(r.choices.some(c=>JSON.stringify(c.value)===JSON.stringify(answer)),`${r.type}/${r.skillId}: ${JSON.stringify(answer)} is legal`);
  if(r.skillId==='holyContract'&&['playerChoice','numberChoice'].includes(r.type))assert.deepEqual(answer,getPolicy('v1.0').chooseAiRuleDecision(r,g));
  return r.type==='skillChoice'&&Object.hasOwn(overrides,r.skillId)?overrides[r.skillId]:answer;
 };
 const options={choose,chooseResponse:choose,overflow:(p,n)=>policy().chooseAiDiscard(g,p.id,n),resolveOverflow:r=>choose(r)};
 g.automaticDecision=choose;
 return {options,requests};
}

test('economy-3 selects and executes a certain morale win and a fifth-cup win',async()=>{
 const g=make('marksman');take(g,0,c=>c.hasUniqueSkill('precisionShot'));fill(g,1,6);g.teams.blue.morale=1;g.startTurn(0);
 const h=harness(g),action=policy().chooseAiAction(g,0);assert.equal(action.type,'play');assert.equal(action.targetId,1);
 await g.executeAction(0,action,h.options);assert.equal(g.winner,'red');assert.ok(h.requests.some(r=>r.skillId==='precisionShot'&&r.answer===true));g.assertCardLocations();
 const cups=make('priest');cups.teams.red.cups=4;cups.addStones('red','gem',3);cups.startTurn(0);
 const ch=harness(cups),finish=policy().chooseAiAction(cups,0);assert.equal(finish.type,'synthesize');await cups.executeAction(0,finish,ch.options);
 assert.equal(cups.teams.red.cups,5);assert.equal(cups.winner,'red');cups.assertCardLocations();
});

test('economy-3 does not report certain spell wins through a public shield or guardian energy',async()=>{
 const shield=make('none');take(shield,0,'magicBullet');fill(shield,1,6);shield.teams.blue.morale=1;
 const c=shield.deck.find(c=>c.name==='holyShield');shield.attachCard(c.id,1,{effectId:'holyShield'});shield.startTurn(0);
 const rank=policy().rankAiActions(shield,0).find(r=>r.action.type==='play');assert.ok(rank);assert.equal(rank.explanation.parts.terminal,0);
 const sh=harness(shield);await shield.executeAction(0,rank.action,{...sh.options,chooseResponse:()=>null});assert.equal(shield.winner,null);assert.equal(shield.teams.blue.morale,1);assert.equal(shield.player(1).getStatus('holyShield').length,0);
 const angel=new Game({seed:93,shuffleDeck:false,heroIds:['marksman','guardianAngel','none','none','none','none']});
 const trap=take(angel,0,c=>c.hasUniqueSkill('flashTrap'));fill(angel,1,5);angel.player(1).energy.crystal=1;angel.teams.blue.morale=1;angel.startTurn(0);
 const ar=policy().rankAiActions(angel,0).find(r=>r.action.skillId==='flashTrap'&&r.action.targetIds[0]===1);assert.ok(ar);assert.equal(ar.explanation.parts.terminal,0);
 const ah=harness(angel);await angel.executeAction(0,{type:'skill',skillId:'flashTrap',cardIds:[trap.id],targetIds:[1]},ah.options);
 assert.equal(angel.winner,null);assert.equal(angel.teams.blue.morale,1);assert.equal(angel.player(1).energy.crystal,0);assert.ok(ah.requests.some(r=>r.skillId==='divineShelter'&&r.type==='numberChoice'));angel.assertCardLocations();
});

test('reachable holyContract player/number choices preserve the legacy legal helper',async()=>{
 const g=make('priest');take(g,0,'fireStrike');g.player(0).energy.crystal=1;g.player(0).healing=2;
 fill(g,3,5);fill(g,4,6);g.player(3).healing=2;g.startTurn(0);
 const h=harness(g,{holyContract:true});
 await g.executeAction(0,{type:'play',index:0,targetId:1},h.options);
 assert.ok(h.requests.some(r=>r.type==='playerChoice'&&r.skillId==='holyContract'&&r.answer===4));
 assert.ok(h.requests.some(r=>r.type==='numberChoice'&&r.skillId==='holyContract'));assert.equal(g.player(0).energy.crystal,0);g.assertCardLocations();
});

test('reachable angelBond is explicitly a one-healing target choice; sealer effect choice is legal',async()=>{
 const g=make('guardianAngel'),card=take(g,0,c=>c.hasUniqueSkill('angelWall'));g.startTurn(0);const h=harness(g);
 await g.executeAction(0,{type:'skill',skillId:'angelWall',cardIds:[card.id],targetIds:[3]},h.options);
 const bond=h.requests.find(r=>r.type==='playerChoice');assert.ok(bond);assert.equal(bond.skillId,'angelBond');assert.equal(g.player(bond.answer).healing,1);g.assertCardLocations();
 const s=make('sealer');s.player(0).energy.crystal=1;s.player(0).energy.gem=1;const poison=s.deck.find(c=>c.name==='poison');s.attachCard(poison.id,1,{effectId:'poison'});s.startTurn(0);const sh=harness(s);
 await s.executeAction(0,{type:'skill',skillId:'sealBreaking',cardIds:[],targetIds:[1]},sh.options);
 assert.ok(sh.requests.some(r=>r.type==='energyChoice'));assert.ok(sh.requests.some(r=>r.type==='effectChoice'&&r.skillId==='sealBreaking'&&r.answer===poison.id));assert.ok(s.player(0).hand.includes(poison));s.assertCardLocations();
});

test('reachable priest and guardian transfers require exactly the requested legal cards',async()=>{
 const g=make('priest'),water=take(g,0,'waterStrike');take(g,0,'fireStrike');g.startTurn(0);const h=harness(g);
 await g.executeAction(0,{type:'skill',skillId:'waterPower',cardIds:[water.id],targetIds:[3]},h.options);
 assert.ok(h.requests.some(r=>r.type==='cardChoice'&&r.purpose==='give'&&r.skillId==='waterPower'));assert.equal(g.player(3).hand.length,1);
 const a=make('guardianAngel'),cost=take(a,0,'waterStrike');fill(a,3,3);a.startTurn(0);const ah=harness(a);
 await a.executeAction(0,{type:'skill',skillId:'angelBlessing',cardIds:[cost.id],targetIds:[3]},ah.options);
 assert.ok(ah.requests.some(r=>r.type==='cardChoice'&&r.request.playerId===3&&r.request.count===2));assert.equal(a.player(3).hand.length,1);assert.equal(a.player(0).hand.length,2);a.assertCardLocations();
});

test('reachable berserker hit offers and wind third-attack number/discard choices stay legal',async()=>{
 const b=make('berserker');take(b,0,'darkStrike');b.player(0).energy.gem=1;fill(b,1,4);b.player(1).healing=1;b.startTurn(0);const bh=harness(b);
 await b.executeAction(0,{type:'play',index:0,targetId:1},bh.options);assert.ok(bh.requests.some(r=>r.skillId==='rend'));assert.ok(bh.requests.some(r=>r.type==='healing'));b.assertCardLocations();
 const w=make('windSwordmaster');for(let i=0;i<3;i++)take(w,0,'windStrike');take(w,0,'poison');take(w,0,'weakness');w.player(0).energy.crystal=1;w.startTurn(0);
 const wh=harness(w,{windFury:true,swordShadow:true});
 for(let i=0;i<3;i++){const index=w.player(0).hand.findIndex(c=>c.type==='attack'&&c.elements.includes('wind'));assert.ok(index>=0);await w.executeAction(0,{type:'play',index,targetId:1},wh.options);}
 assert.ok(wh.requests.some(r=>r.type==='numberChoice'&&r.skillId==='holySword'));assert.ok(wh.requests.some(r=>r.type==='cardChoice'&&r.purpose==='discard'));w.assertCardLocations();
});

// Forward-compatible metadata uses the existing helper, not angelBond semantics.
test('unknown playerChoice purpose from the real engine keeps legacy fallback',()=>{
 const g=make('priest');g.player(3).healing=2;fill(g,4,6);
 const flow=g.choosePlayer(0,[3,4],'fixture future target',{skillId:'futurePurpose'});
 const request=flow.next().value,answer=policy().chooseAiRuleDecision(request,g);
 assert.equal(request.type,'playerChoice');assert.equal(answer,getPolicy('v1.0').chooseAiRuleDecision(request,g));assert.equal(answer,4);assert.equal(flow.next(answer).value,4);
});
