import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, Timing } from '../src/engine.js';
import { resolveSync } from '../src/resolution/decisions.js';
import { playableCards } from '../src/playable-cards.js';
import { captureObservation } from '../src/ai/observation.js';
import { encodeEntities } from '../training/entity/observation.mjs';
import { decisionCandidates } from '../training/candidates.mjs';
const make=hero=>new Game({seed:91,shuffleDeck:false,heroIds:[hero,'none','none','none','none','none']});
const take=(g,id,fn)=>{const c=g.deck.find(fn);assert.ok(c);g.moveCard(c.id,{zone:'hand',playerId:id});return c;};
const base=r=>r.type==='response'?null:r.defaultValue;
const run=(steps,choose=base)=>resolveSync(steps,choose);

test('精灵：祝福独立于手牌，可主动使用和确认响应，盖牌隐私与候选实体一致',()=>{
 const g=new Game({seed:91,heroIds:['elfArcher','berserker','berserker','berserker','berserker','berserker']}),p=g.player(0);p.energy.gem=1;
 run(g.trigger(Timing.ACTIVATION,{playerId:0}),r=>r.skillId==='elfRitual'?true:base(r));
 assert.equal(p.hand.length,0);assert.equal(p.covered.length,3);
 for(const c of [...p.covered])g.discardCovered(0,c,{});
 const light=take(g,0,c=>c.name==='holyLight');g.coverCards(0,[light],'blessing');
 const attack=take(g,1,c=>c.type==='attack');
 run(g.actionSteps(1,0,0),r=>{
  if(r.type==='response'){
   assert.equal(r.valid[0].card,light);const candidates=decisionCandidates(g,r);
   const encoded=encodeEntities({game:g,playerId:0,request:r,candidates});assert.equal(encoded.candidates[1].refs.cards.length,1);
   assert.ok(!captureObservation(g,1).cards.some(c=>c.id===light.id));return {index:0};
  }return base(r);
 });
 assert.equal(light.location.zone,'discard');assert.equal(p.hand.length,0);
 const water=take(g,0,c=>c.name==='waterStrike');g.coverCards(0,[water],'blessing');
 assert.equal(playableCards(p)[0],water);g.play(0,0,1);assert.equal(water.location.zone,'discard');g.assertCardLocations();
});

test('阴阳：同命格异系应战，转换后鬼火伤害；式神咒束两宝石代接目标',()=>{
 const g=make('yinYangMaster'),p=g.player(0);p.hero.state.form='shikigami';p.hero.state.ghostFire=1;
 const incoming=take(g,1,c=>c.name==='waterStrike'&&c.fates.includes('X'));
 const answer=take(g,0,c=>c.name==='fireStrike'&&c.fates.includes('X'));
 g.attack(1,0,0,{responses:{0:{index:0,targetId:2}}});
 assert.equal(g.canRespond(g.deck.find(c=>c.name==='darkStrike'),g.deck.find(c=>c.type==='attack'&&c.fates.includes('X')),{actorId:1,targetId:0,attackTraits:{elements:['dark'],fates:['X']}}),false);
 assert.equal(p.hero.state.ghostFire,2);assert.equal(p.hero.state.form,null);assert.equal(g.player(2).hand.length,2);
 p.hero.state.form='shikigami';g.addStones('red','gem',2);take(g,1,c=>c.name==='fireStrike');const counter=take(g,0,c=>c.name==='fireStrike');
 const before=g.player(3).hand.length;
 run(g.actionSteps(1,0,3),r=>{
  if(r.skillId!=='shikigamiBinding')return base(r);
  assert.equal(g.timeline.at(-1).timing,Timing.ATTACK_RESPONSE_BEFORE);assert.equal(g.timeline.at(-1).point,1);
  return {index:0,targetId:2};
 });
 assert.equal(g.player(3).hand.length,before);assert.equal(counter.location.zone,'discard');assert.equal(g.stoneCounts('red').gem,1);g.assertCardLocations();
 for(const restriction of ['forceHitRequested','canCounter',null]){
  const h=make('yinYangMaster'),owner=h.player(0);owner.hero.state.form='shikigami';h.addStones('red','gem',2);
  take(h,1,c=>c.name==='fireStrike');const kept=take(h,0,c=>c.name==='fireStrike');
  const attacker=h.player(1).hero;
  if(restriction)attacker.addSkills({id:'responseRestriction',...attacker.onOwnAttack([Timing.ATTACK_DECLARED]),priority:-1000,resolve({context}){context[restriction]=restriction==='forceHitRequested';}});
  const responses=[];
  run(h.actionSteps(1,0,3),r=>{if(r.type==='response')responses.push(r.target.id);if(restriction)assert.notEqual(r.skillId,'shikigamiBinding');return base(r);});
  assert.deepEqual(responses,restriction==='forceHitRequested'?[]:restriction?[3]:[0,3]);
  assert.ok(h.timeline.some(entry=>entry.timing===Timing.ATTACK_DECISION));
  assert.equal(kept.location.zone,'hand');assert.equal(h.stoneCounts('red').gem,2);assert.equal(h.player(3).hand.length,2);h.assertCardLocations();
 }
});

test('灵魂：所有士气下降吸魂；链接转移只进时点6，囚徒减伤且不能再次治疗',()=>{
 const g=new Game({seed:3,heroIds:['soulWarlock','none','none','bard','none','none']}),p=g.player(0),bard=g.player(3);
 g.changeMorale('red',-2);run(g.flushRuleEvents());assert.equal(p.hero.state.yellowSoul,2);
 p.hero.state.blueSoul=4;run(g.trigger(Timing.ACTIVATION,{playerId:0}),r=>r.skillId==='soulLink'?(r.type==='playerChoice'?3:true):base(r));
 assert.equal(g.cards.get(p.hero.state.linkCardId).location.playerId,3);
 bard.hero.state.form='eternalPrisoner';bard.healing=2;
 let bardPoint3=0;bard.hero.addSkills({id:'probe',...bard.hero.onDamage([Timing.DAMAGE_BEFORE],'target',['spell']),resolve(){bardPoint3++;}});
 run(g.damageSteps(0,3,{sourceId:1,damageType:'attack'}),r=>r.skillId==='soulTransfer'?2:base(r));
 assert.equal(p.hand.length,1);assert.equal(bard.hand.length,1);assert.equal(bardPoint3,0);assert.equal(bard.healing,2);assert.equal(p.hero.state.blueSoul,1);
 assert.ok(g.timeline.some(t=>t.timing===Timing.DAMAGE_ACTUAL&&t.playerId===3));g.assertCardLocations();
});

test('血巫：同生共死对自己只改一次；流血换形即时调整手限并暗弃，不额外扣士气',()=>{
 const g=make('bloodWitch'),p=g.player(0);
 run(g.skillActionSteps(0,{skillId:'sharedFate',targetIds:[0]}));assert.equal(p.handLimit,4);assert.equal(p.hand.length,2);
 run(g.damageSteps(0,3,{sourceId:1,damageType:'spell'}));assert.equal(p.hero.state.form,'bleeding');assert.equal(p.handLimit,7);assert.equal(p.healing,1);assert.equal(g.teams.red.morale,14);
 g.discardCards(0,p.hand.slice(0,2),{visibility:'hidden'});run(g.flushRuleEvents());assert.equal(p.hero.state.form,null);assert.equal(p.handLimit,4);assert.equal(g.teams.red.morale,14);
 g.assertCardLocations();
});

test('月神：庇护保留爆牌实体，批量移除暗月只扣1士气；额外回合按队列执行',()=>{
 const g=make('moonGoddess'),p=g.player(0);g.player(3).handLimit=0;
 run(g.damageSteps(3,2,{sourceId:1,damageType:'spell'}),r=>r.skillId==='newMoonShelter'?true:base(r));assert.equal(p.covered.length,2);assert.equal(g.teams.red.morale,15);assert.equal(p.hero.state.form,'darkMoon');
 run(p.hero.removeMoons(g,p,[...p.covered],{}));assert.equal(g.teams.red.morale,14);assert.equal(p.hero.state.form,null);
 p.hero.state.petrification=3;p.energy.gem=1;g.startTurn(0);
 run(g.skillActionSteps(0,{skillId:'paleMoon',mode:'turn',targetIds:[]}));assert.equal(g.turn.hasExtraActions(),true);g.skipExtraActions(0);g.endTurn();assert.equal(g.current,0);
 g.assertCardLocations();
});

test('圣弓：零治疗爆裂、圣命格虚拟攻击；第五杯终止后续士气调整',()=>{
 const g=make('holyArcher'),p=g.player(0);assert.equal(p.energy.crystal,2);assert.equal(g.getHealingLimit(0),3);
 p.hero.state.form='radiant';run(g.skillActionSteps(0,{skillId:'holyBurst',mode:'support',targetIds:[3]}));assert.equal(p.hero.state.faith,1);assert.equal(g.player(3).healing,1);
 const costs=[take(g,0,c=>c.name==='fireStrike'),take(g,0,c=>c.name==='fireStrike')];
 run(g.skillActionSteps(0,{skillId:'holyHurricane',cardIds:costs.map(c=>c.id),targetIds:[1]}));assert.equal(g.player(1).hand.length,2);assert.equal(p.hero.state.faith,2);
 p.hero.state.faith=4;g.teams.red.cups=4;g.player(5).handLimit=3;
 let adjustmentsDrew=false;p.hero.addSkills({id:'adjustProbe',...p.hero.bind('player',[Timing.DRAW_BEFORE],'all'),resolve(){adjustmentsDrew=true;}});
 run(g.skillActionSteps(0,{skillId:'radiantCannon',targetIds:[]}),r=>{assert.notEqual(r.skillId,'radiantCannonMorale');return base(r);});assert.equal(g.winner,'red');assert.equal(g.teams.red.cups,5);assert.equal(g.player(5).hand.length,3);assert.equal(adjustmentsDrew,false);g.assertCardLocations();
});
