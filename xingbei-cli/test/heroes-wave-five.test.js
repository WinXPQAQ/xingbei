import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, Timing } from '../src/engine.js';
import { resolveSync } from '../src/resolution/decisions.js';
import { captureObservation } from '../src/ai/observation.js';
import { encodeEntities } from '../training/entity/observation.mjs';
const make = hero => new Game({seed:81,shuffleDeck:false,heroIds:[hero,'none','none','none','none','none']});
const take = (g,id,predicate) => {const c=g.deck.find(predicate);assert.ok(c);g.moveCard(c.id,{zone:'hand',playerId:id});return c;};
const base = r => r.type==='response'?null:r.defaultValue;
const run = (steps,choose=base) => resolveSync(steps,choose);
const cover = (g,id,element,pile) => {const c=take(g,id,c=>c.element===element);g.coverCards(id,[c],pile);return c;};

test('灵符：费用明弃、双目标按顺位结算后念咒；妖力展示移除不产生封印事件',()=>{
 const g=make('talismanMaster');const cost=take(g,0,c=>c.element==='thunder');take(g,0,c=>c.element==='fire');g.player(0).energy.crystal=1;
 run(g.skillActionSteps(0,{skillId:'thunderTalisman',cardIds:[cost.id],targetIds:[3,1]}),r=>{
  if(r.skillId==='spiritCollapse')return true;if(r.skillId==='chant'){assert.equal(g.player(1).hand.length,2);assert.equal(g.player(3).hand.length,2);return [0];}return base(r);
 });
 assert.deepEqual(g.timeline.filter(e=>e.timing===Timing.DAMAGE_BEFORE).map(e=>e.playerId),[1,3]);
 assert.equal(g.player(0).covered.length,1);assert.equal(cost.discardVisibility,'public');
 g.discardCovered(0,g.player(0).covered[0],{reveal:true,skillId:'hundredGhosts'});assert.equal(g.pendingRuleEvents.length,0);g.assertCardLocations();
});

test('剑帝：未命中保留实体剑魂及佯攻；奇偶魂效果互斥，命中剑气插入法伤',()=>{
 const g=make('swordEmperor');const attack=take(g,0,c=>c.name==='waterStrike');take(g,1,c=>c.name==='holyLight');
 g.attack(0,0,1,{responses:{1:{index:0}}});assert.equal(attack.location.zone,'covered');assert.equal(g.player(0).hero.state.swordQi,1);
 g.player(0).energy.gem=1;take(g,0,c=>c.type==='attack');
 run(g.actionSteps(0,0,1),r=>{if(r.skillId==='angelSoul')return attack.id;if(r.skillId==='swordQiSlash')return r.type==='playerChoice'?2:1;return base(r);});
 assert.equal(attack.location.zone,'discard');assert.equal(g.player(0).healing,2);assert.equal(g.player(2).hand.length,1);assert.equal(g.player(0).hero.state.swordQi,0);g.assertCardLocations();
});

test('魔弓：雷光先支付全部充能再按顺位法伤；多重射击是独立暗系攻击',()=>{
 const g=make('magicArcher');cover(g,0,'thunder','charge');cover(g,0,'thunder','charge');
 const order=[];g.player(0).hero.addSkills({id:'probe',...g.player(0).hero.onDamage([Timing.DAMAGE_BEFORE],'actor',['spell']),resolve({context}){assert.equal(g.player(0).covered.length,0);order.push([context.targetId,context.amount]);}});
 run(g.skillActionSteps(0,{skillId:'thunderScatter',mode:'2',targetIds:[2]}));assert.deepEqual(order,[[1,1],[2,2],[5,1]]);
 const wind=cover(g,0,'wind','charge');take(g,0,c=>c.type==='attack');g.startTurn(0);
 run(g.actionSteps(0,0,1),r=>r.skillId==='multiShot'?wind.id:base(r));
 assert.equal(g.turn.nextAction().sourceSkillId,'multiShot');assert.equal(g.legalCards(0).length,0);
 const before=g.player(2).hand.length;
 run(g.skillActionSteps(0,{skillId:'multiShotAttack',targetIds:[2]}));assert.equal(g.player(2).hand.length,before+1);
 assert.equal(g.turn.state.attackCount,2);assert.equal(g.cards.size,150);g.assertCardLocations();
 const end=make('magicArcher');cover(end,0,'thunder','charge');end.player(1).handLimit=0;end.teams.blue.morale=1;
 run(end.skillActionSteps(0,{skillId:'thunderScatter',mode:'1',targetIds:[1]}));assert.equal(end.winner,'red');assert.equal(end.player(2).hand.length,0);
});

test('苍炎：属性覆盖仅自己；先中毒虚弱再重置；法伤实际降士气才增加重生',()=>{
 const g=make('azureFlameWitch'),p=g.player(0);p.hero.state={form:'flame',rebirth:4};
 const wind=take(g,0,c=>c.name==='windStrike');assert.deepEqual(wind.getTraits({game:g,playerId:0}).elements,['fire']);assert.deepEqual(wind.getTraits({game:g,playerId:1}).elements,['wind']);
 for(let i=0;i<6;i++)take(g,0,()=>true);
 for(const name of ['poison','weakness']){const c=g.deck.find(c=>c.name===name);g.attachCard(c.id,0,{effectId:name,sourcePlayerId:1});}
 run(g.trigger(Timing.ACTION_PHASE_BEFORE,{playerId:0}),r=>{if(r.type==='weakness'){assert.equal(p.hero.state.form,'flame');assert.equal(p.hand.length,8);return 'skip';}return base(r);});
 assert.equal(p.hero.state.form,null);assert.equal(p.hand.length,6);assert.equal(g.teams.red.morale,13);
 p.hero.state.rebirth=0;run(g.damageSteps(0,1,{sourceId:1,damageType:'spell'}));assert.equal(p.hero.state.rebirth,1);
 run(g.damageSteps(0,1,{sourceId:1,damageType:'attack'}));assert.equal(p.hero.state.rebirth,1);g.assertCardLocations();
});

test('血剑：庭院独立场外实体，禁止双方治疗抵伤；结束移除及鲜血超限保留',()=>{
 const g=make('bloodSwordSpirit'),p=g.player(0),card=g.cards.get(p.hero.state.gardenCardId);assert.equal(card.location.zone,'outside');
 p.energy.gem=1;p.hero.state.blood=2;
 run(g.trigger(Timing.ACTIVATION,{playerId:0}),r=>r.skillId==='petalDance'?'gem':base(r));assert.equal(p.hero.state.blood,4);assert.equal(card.location.zone,'field');
 g.changeHealing(1,2);run(g.damageSteps(1,1,{sourceId:0,damageType:'spell'}),r=>{assert.notEqual(r.type,'healing');return base(r);});assert.equal(g.player(1).healing,2);
 run(g.trigger(Timing.ATTACK_HIT,{actorId:0,targetId:1,isCounter:false}));assert.equal(p.hero.state.blood,4);
 run(g.trigger(Timing.TURN_END,{playerId:0}));assert.equal(card.location.zone,'outside');g.assertCardLocations();
});

test('兽灵：横置效果完成后警戒；居合保留命中战绩并只替代伤害；无念强中仍过时点2',()=>{
 const g=make('beastWarrior'),p=g.player(0);p.hero.state={souls:2,residual:0,form:'iaido'};take(g,0,c=>c.type==='attack');take(g,1,()=>true);
 run(g.actionSteps(0,0,1),r=>r.skillId==='reverseIaido'?0:base(r));assert.equal(g.stoneCounts('red').gem,1);assert.equal(g.teams.blue.morale,14);assert.equal(g.player(1).hand.length,0);assert.equal(g.timeline.some(e=>e.timing===Timing.DAMAGE_BEFORE),false);assert.equal(p.hero.state.form,'iaido');
 const h=new Game({heroIds:['beastWarrior','assassin','none','none','none','none']});h.player(0).hero.state.souls=1;h.player(1).energy.gem=1;take(h,1,c=>c.type==='spell');
 run(h.trigger(Timing.ACTIVATION,{playerId:1}),r=>{if(r.skillId==='stealth')return r.type==='skillChoice'?true:1;if(r.skillId==='beastVigilance'){assert.equal(h.player(1).hand.length,2);return r.type==='skillChoice'?true:1;}return base(r);});
 assert.equal(h.player(0).hero.state.form,'iaido');assert.equal(h.player(0).hero.state.souls,1);assert.equal(h.player(0).hero.state.residual,1);
 const n=make('beastWarrior');take(n,0,c=>c.type==='attack'&&c.fate==='J');take(n,1,c=>c.name==='holyLight');const shield=n.deck.find(c=>c.name==='holyShield');n.attachCard(shield.id,1,{effectId:'holyShield'});n.startTurn(0);n.turn.state.completed=true;n.turn.addAttackAction({sourceSkillId:'thoughtlessStrike'});
 run(n.actionSteps(0,0,1),r=>{assert.notEqual(r.type,'response');return base(r);});assert.equal(n.player(1).getStatus('holyShield').length,1);assert.ok(n.timeline.some(e=>e.timing===Timing.ATTACK_DECISION));assert.equal(n.stoneCounts('red').gem,1);g.assertCardLocations();h.assertCardLocations();n.assertCardLocations();
});

test('盖牌观测：持有者可见，其他座位不含牌面或ID；位置守恒与实体候选可编码',()=>{
 const g=new Game({playerHeroId:'magicArcher',shuffleDeck:false}),c=cover(g,0,'fire','charge');
 const own=captureObservation(g,0),other=captureObservation(g,1);assert.ok(own.cards.some(x=>x.id===c.id));assert.ok(!other.cards.some(x=>x.id===c.id));assert.equal(other.players[0].coveredCount,1);
 const encode=id=>encodeEntities({game:g,playerId:id,request:{type:'effectChoice',playerId:id,choices:[]},candidates:[null]});
 const before=JSON.stringify(encode(1));const raw=JSON.stringify(other);
 g.moveCard(c.id,{zone:'deck'},{animate:false});const replacement=g.deck.find(x=>x.element==='water');g.moveCard(replacement.id,{zone:'covered',playerId:0,pile:'charge'},{animate:false});
 // Direct fixture moves do not expose faces; both encoders must remain identical.
 assert.equal(JSON.stringify(captureObservation(g,1)),raw);assert.equal(JSON.stringify(encode(1)),before);
 const ownEncoded=encodeEntities({game:g,playerId:0,request:{type:'effectChoice',playerId:0},candidates:[replacement.id]});assert.ok(ownEncoded);g.assertCardLocations();
});
