import test from 'node:test';
import assert from 'node:assert/strict';
import {Game,Timing} from '../src/engine.js';
import {resolveSync} from '../src/resolution/decisions.js';
const make = hero => new Game({seed:81,shuffleDeck:false,heroIds:[hero,'none','none','none','none','none']});
const take = (g,id,predicate) => {const c=g.deck.find(predicate);assert.ok(c);g.moveCard(c.id,{zone:'hand',playerId:id});return c;};
const base = r => r.type==='response'?null:r.defaultValue;
const run = (steps,choose=base) => resolveSync(steps,choose);

test('格斗家：气绝在攻击前自伤，伤害上限4，仍保留圣光响应',()=>{
 const g=make('fighter');g.player(0).hero.state.spirit=6;
 const card=take(g,0,c=>c.type==='attack');take(g,1,c=>c.name==='holyLight');
 run(g.actionSteps(0,0,1),r=>{
  if(r.type==='skillChoice')return r.skillId==='stunningBlow';
  if(r.type==='response'){assert.equal(g.player(0).hand.length,4);assert.deepEqual(r.valid.map(v=>v.card.name),['holyLight']);}
  return base(r);
 });
 assert.equal(g.player(0).hero.state.spirit,5);assert.equal(card.location.zone,'discard');g.assertCardLocations();
});
test('魔枪：禁用圣光，暗之障壁整组弃牌，形态手限及启动互斥',()=>{
 const g=make('magicLancer');const light=take(g,0,c=>c.name==='holyLight');const spell=take(g,0,c=>c.type==='spell'&&c.element!=='thunder');const thunder=take(g,0,c=>c.type==='attack'&&c.element==='thunder');
 assert.equal(g.allowsCard(0,light,'response'),false);
 run(g.damageSteps(0,1,{sourceId:1,damageType:'spell'}),r=>{
  if(r.skillId==='darkBarrier'&&r.type==='numberChoice')return r.choices.some(c=>c.value==='spell')?'spell':2;
  if(r.type==='cardChoice'){assert.ok(r.valid.every(i=>g.player(0).hand[i].type==='spell'));return r.valid.slice(0,r.count);}
  return base(r);
 });
 assert.equal(light.location.zone,'discard');assert.equal(spell.location.zone,'discard');assert.equal(thunder.location.zone,'hand');
 g.startTurn(0);run(g.actionSteps(0,g.player(0).hand.indexOf(thunder),1),r=>r.type==='skillChoice'?r.skillId==='darkRelease':base(r));
 assert.equal(g.player(0).handLimit,5);assert.equal(g.player(0).hero.state.form,'phantom');g.assertCardLocations();
});
test('红莲：只能治疗自身伤害，首次爆牌进入热血，后续伤害不降士气',()=>{
 const g=make('redLotusKnight');g.player(0).handLimit=0;g.changeHealing(0,4);
 run(g.damageSteps(0,2,{sourceId:1,damageType:'attack'}));assert.equal(g.teams.red.morale,13);assert.equal(g.player(0).healing,4);
 run(g.damageSteps(0,2,{sourceId:1,damageType:'spell'}));assert.equal(g.teams.red.morale,13);
 run(g.damageSteps(0,2,{sourceId:0,damageType:'spell'}),r=>r.type==='healing'?2:base(r));assert.equal(g.player(0).healing,2);
 g.assertCardLocations();
});
test('勇者：死斗只限制本次士气，挑衅是唯一专属并允许跳过',()=>{
 const g=make('brave');g.player(0).energy.gem=1;g.player(0).handLimit=0;
 run(g.damageSteps(0,3,{sourceId:1,damageType:'spell'}),r=>r.type==='skillChoice'?r.skillId==='deathMatch':base(r));
 assert.equal(g.teams.red.morale,14);assert.equal(g.player(0).hero.state.rage,3);
 run(g.damageSteps(0,2,{sourceId:1,damageType:'spell'}));assert.equal(g.teams.red.morale,12);
 run(g.skillActionSteps(0,{skillId:'provocation',cardIds:[],targetIds:[1]}));
 assert.equal(g.player(1).getBasicEffects().length,0);assert.equal(g.allowsAction(1,'spell'),false);assert.equal(g.canAttackTarget(1,3),false);
 g.current=1;run(g.turn.start(1));assert.equal(g.turn.state.skipped,true);assert.equal(g.cards.get('provocation-0').location.zone,'outside');g.assertCardLocations();
});
test('冒险家：欺诈不增加实体牌，费用明弃，购买两宝石，零能量可天堂',()=>{
 const g=make('adventurer');const cards=[take(g,0,c=>c.element==='fire'),take(g,0,c=>c.element==='fire')];const count=g.cards.size;
 run(g.skillActionSteps(0,{skillId:'deception',mode:'water',cardIds:cards.map(c=>c.id),targetIds:[1]}));
 assert.equal(g.cards.size,count);assert.equal(g.player(0).energy.crystal,1);assert.ok(cards.every(c=>c.discardVisibility==='public'));
 g.player(0).energy.crystal=0;g.addStones('red','gem',2);
 run(g.skillActionSteps(0,{skillId:'adventurerParadise',mode:'2:0',cardIds:[],targetIds:[3]}));assert.equal(g.player(3).energy.gem,2);
 const before=g.stoneCounts('red');g.purchase(0);assert.equal(g.stoneCounts('red').crystal,before.crystal);g.assertCardLocations();
});
test('吟游新版：第二敌方时点3触发，囚徒减法伤，队友胜利交响诗转星石为宝石并治疗诗人',()=>{
 const g=make('bard');const cards=[take(g,0,c=>c.element==='water'),take(g,0,c=>c.element==='water')];
 run(g.damageSteps(1,1,{sourceId:3,damageType:'spell'}));
 let beforeDamage=false;
 run(g.damageSteps(2,1,{sourceId:3,damageType:'spell'}),r=>{
  if(r.skillId==='sinkingConcerto'&&r.type==='cardChoice'){beforeDamage=g.player(2).hand.length===0;return r.validSets[0];}return base(r);
 });
 assert.equal(beforeDamage,true);assert.equal(g.player(0).hero.state.inspiration,1);assert.ok(cards.every(c=>c.location.zone==='discard'));
 g.player(0).hero.state.form='eternalPrisoner';run(g.damageSteps(0,2,{sourceId:1,damageType:'spell'}));assert.equal(g.player(0).hand.length,1);
 const song=g.cards.get('eternalMovement-0');g.attachCard(song.id,3,{effectId:'eternalMovement',sourcePlayerId:0});g.addStones('red','crystal',1);
 run(g.trigger(Timing.TURN_END,{playerId:3}),r=>r.type==='skillChoice'?true:r.skillId==='victorySymphony'?'crystal':base(r));
 assert.equal(g.player(3).energy.gem,1);assert.equal(g.player(3).energy.crystal,0);assert.equal(g.player(0).healing,1);assert.equal(song.location.zone,'outside');g.assertCardLocations();
});
