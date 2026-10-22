import test from 'node:test';
import assert from 'node:assert/strict';
import {activeAttackPriority,missingRetention,ordinaryResponse,preservesSpecialties} from '../src/ai/v1.5.2-rules/specialties.js';
import {Game} from '../src/engine.js';
import {getPolicy} from '../src/ai/versions.js';
import {createDeck} from '../src/cards.js';

const card=(id,uniqueSkills=[],element='fire')=>({id,type:'attack',name:'attack',uniqueSkills,elements:[element]});
const player=(hero,skillIds,hand)=>({id:0,hero,skillIds,hand});
test('狂战主动技能优先级只认正好2治疗和2/3手牌，保留价值按张递减',()=>{
 const roar=card('roar',['bloodyRoar']), blade=card('blade',['bloodBlade']);
 const p=player('berserker',['bloodyRoar','bloodBlade'],[roar,blade]);
 assert.equal(missingRetention(p),4);
 p.hand.push(card('roar2',['bloodyRoar']));assert.equal(missingRetention(p),5);
 for(const healing of [0,1,2,3,4,6])assert.equal(activeAttackPriority(p,roar,{healing,count:4}),healing===2?2:0);
 for(const count of [0,1,2,3,4,6])assert.equal(activeAttackPriority(p,blade,{healing:0,count}),[2,3].includes(count)?2:0);
 assert.equal(activeAttackPriority(p,card('plain'),{healing:2,count:2}),0);
});
test('封印作为统一保留用途，应战替换同属性普通刀且不换目标',()=>{
 const seal=card('seal',['fireSeal']),plain=card('plain'),water=card('water',[],'water');
 const p=player('sealer',['fireSeal','waterSeal'],[seal,water,plain]);
 assert.equal(activeAttackPriority(p,seal,{}),-2);
 assert.equal(missingRetention(p),2);
 p.hand.push(card('seal2',['waterSeal'],'water'));assert.equal(missingRetention(p),3);
 assert.deepEqual(ordinaryResponse(p,[{index:0},{index:1},{index:2}],{index:0,targetId:5}),{index:2,targetId:5});
 assert.deepEqual(ordinaryResponse(p,[{index:0},{index:1}],{index:0,targetId:5}),{index:0,targetId:5});
 assert.equal(ordinaryResponse(p,[],null),null);
});
test('爆牌保留只属于当前英雄的同属性攻击独有技，神官水牌无额外标签价值',()=>{
 const special=card('special',['bloodyRoar']),plain=card('plain');
 const p=player('berserker',['bloodyRoar'],[special,plain]);
 assert.equal(preservesSpecialties(p,[special]),false);
 assert.equal(preservesSpecialties(p,[plain]),true);
 assert.equal(preservesSpecialties(p,[special,plain]),true);
 assert.equal(preservesSpecialties(p,[special],[special]),true);
 assert.equal(preservesSpecialties({...p,skillIds:[]},[special]),true);
 assert.equal(missingRetention(player('priest',['waterPower'],[card('water',[],'water')])),0);
});
test('六英雄真实牌表通过新版爆牌入口，旧策略仍为独立冻结对象',()=>{
 const policy=getPolicy('experimental/hero-foundation-1');
 assert.notEqual(policy,getPolicy('v1.5'));
 const game=new Game({seed:2718}).setup();
 const deck=createDeck();
 for(const p of game.players){
  const ids=p.getSkills().map(({skill})=>typeof skill==='string'?skill:skill.id);
  const unique=deck.find(c=>c.type==='attack'&&c.uniqueSkills.some(id=>ids.includes(id)));
  if(!unique){assert.equal(p.hero.id,'priest');continue;}
  const ordinary=deck.find(c=>c.type==='attack'&&c.element===unique.element&&!c.uniqueSkills.some(id=>ids.includes(id)));
  assert.ok(ordinary);
  for(const c of [...p.hand])game.moveCard(c.id,{zone:'outside'});
  for(const c of [unique,ordinary])game.moveCard(c.id,{zone:'hand',playerId:p.id});
  assert.deepEqual(policy.chooseAiDiscard(game,p.id,1),[1],p.hero.id);
 }
});
