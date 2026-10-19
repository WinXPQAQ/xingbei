import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/engine.js';
import {captureObservation,observationView} from '../src/ai/observation.js';
import {getPolicy} from '../src/ai/versions.js';
import {stateOf,clone,giftOptionValue,components,transfer,overflow,damage} from '../src/ai/action-value2/model.js';
import {teamOpportunity,conversionChance,capacityCost,drawDanger} from '../src/ai/action-value2/routes.js';
import {actionPlan} from '../src/ai/action-value2/planner.js';
const make=()=>new Game({seed:73,heroIds:['priest','marksman','sealer','guardianAngel','windSwordmaster','berserker']});
const take=(g,id,fn)=>g.moveCard(g.deck.find(fn).id,{zone:'hand',playerId:id});
const model=g=>stateOf(observationView(captureObservation(g,0,{actions:true})),0);
const policy=getPolicy('experimental/action-value-2');
test('current legal fifth cup beats preparation and matches real engine win; ordinary attack cannot synthesize afterward',async()=>{
 const g=make();take(g,0,c=>c.type==='attack');g.addStones('red','gem',3);g.teams.red.cups=4;g.teams.red.morale=1;g.startTurn(0);
 assert.equal(policy.chooseAiAction(g,0).type,'synthesize');
 await g.executeAction(0,policy.chooseAiAction(g,0));assert.equal(g.winner,'red');
 const h=make();take(h,0,c=>c.type==='attack');h.addStones('red','gem',3);h.startTurn(0);
 await h.executeAction(0,{type:'play',index:0,targetId:1});assert.equal(h.canDrawSpecial(0),false);assert.throws(()=>h.synthesize(0,3));
});
test('shared route is bounded, grows near fifth cup, and does not count three allied options separately',()=>{
 const s=model(make());s.teams.red.gem=3;s.players[0].count=3;s.players[3].count=5;s.players[4].count=5;
 const early=teamOpportunity(s,'red');s.teams.red.cups=4;assert.ok(teamOpportunity(s,'red')>early*3);
 const late=teamOpportunity(s,'red');s.teams.red.gem=1;assert.ok(teamOpportunity(s,'red')<late/4);
 s.teams.red.gem=3;s.players[3].count=3;s.players[4].count=3;assert.ok(teamOpportunity(s,'red')<180);
});
test('enemy fifth-cup blocking responds to resources, seats, potential pre-turn responses and alternate synthesizers',()=>{
 const s=model(make());s.teams.blue.gem=3;s.teams.blue.cups=4;for(const p of s.players)p.count=0;
 for(const id of [2,5])s.players[id].count=6;s.players[1].count=3;
 const ready=teamOpportunity(s,'blue');s.players[1].count=4;const blocked=teamOpportunity(s,'blue');assert.ok(ready-blocked>40);
 s.teams.blue.gem=1;const poorBlocked=teamOpportunity(s,'blue');s.players[1].count=3;assert.ok(teamOpportunity(s,'blue')-poorBlocked<(ready-blocked)/4);
 const p=s.players[5];p.count=4;const noResponse=conversionChance(s,p);s.players[3].count=3;s.players[4].count=3;assert.ok(conversionChance(s,p)>noResponse);
 s.teams.blue.gem=3;s.players[2].count=0;s.players[1].count=4;assert.ok(teamOpportunity(s,'blue')>blocked);
});
test('actual wind gift unlocks angel cleansing of basic seal and healing, without inventing recipient skills',async()=>{
 const g=make(),water=take(g,0,c=>c.elements.includes('water')),wind=take(g,0,c=>c.elements.includes('wind'));
 take(g,2,c=>c.type==='attack');
 const seal=g.deck.find(c=>c.hasUniqueSkill('fireSeal'));g.attachCard(seal.id,4,{effectId:'fireSeal',sourcePlayerId:2});
 g.startTurn(0);const s=model(g);transfer(s,0,3,s.players[0].hand.find(c=>c.id===wind.id));
 const useful=giftOptionValue(s,s.players[3]);assert.ok(useful>0);const absent=clone(s);absent.players[3].skillIds=[];assert.equal(giftOptionValue(absent,absent.players[3]),0);
 const clear=clone(s);for(const p of clear.players)p.effects=[];assert.ok(giftOptionValue(clear,clear.players[3])<useful);
 const noThreat=clone(clear);noThreat.players[2].skillIds=[];assert.ok(giftOptionValue(noThreat,noThreat.players[3])<giftOptionValue(clear,clear.players[3]));
 await g.executeAction(0,{type:'skill',skillId:'waterPower',cardIds:[water.id],targetIds:[3]},{choose:r=>r.type==='cardChoice'?[g.player(0).hand.findIndex(c=>c.id===wind.id)]:r.defaultValue});
 assert.equal(g.player(3).healing,1);g.endTurn();g.startTurn(3);
 assert.ok(g.legalSkillActions(3).some(x=>x.skillId==='windCleansing'));
 await g.executeAction(3,{type:'skill',skillId:'windCleansing',cardIds:[wind.id],targetIds:[4]},{choose:r=>r.type==='effectChoice'?seal.id:r.type==='playerChoice'?3:r.defaultValue});
 assert.equal(g.player(4).getStatus('fireSeal').length,0);assert.equal(g.player(3).healing,2);
});
test('full stone capacity has no automatic reward without gain opportunities; low morale weak hand has greater post-buy risk',()=>{
 const s=model(make());s.teams.red.gem=5;assert.equal(capacityCost(s,'red'),0);
 s.players[3].count=3;assert.ok(capacityCost(s,'red')>0);s.teams.red.gem=4;assert.equal(capacityCost(s,'red'),0);
 const g=make();for(let i=0;i<3;i++)take(g,0,c=>c.name==='weakness');for(const id of [1,2,5])take(g,id,c=>c.type==='attack');g.teams.red.morale=1;g.startTurn(0);
 const low=model(g),after=actionPlan(low,0,{type:'purchase'}).branches[0].state;
 assert.ok(drawDanger(after,after.players[0])>drawDanger(low,low.players[0]));
 const safe=clone(after);safe.teams.red.morale=15;assert.equal(drawDanger(safe,safe.players[0]),0);
 const defended=clone(after);defended.players[0].hand=[{type:'spell',name:'holyLight',elements:['light']}];assert.ok(drawDanger(defended,defended.players[0])<drawDanger(after,after.players[0]));
});
test('private teammate/enemy faces and future deck order cannot change candidate ranking',()=>{
 const g=make();for(let i=0;i<4;i++)take(g,0,c=>c.type==='attack');for(let id=1;id<6;id++)take(g,id,c=>c.type==='attack');g.startTurn(0);
 const before=policy.rankAiActions(g,0),obs=captureObservation(g,0,{actions:true});
 for(let id=1;id<6;id++){const old=g.player(id).hand[0];const next=g.deck.find(c=>c.name==='holyLight');g.moveCard(old.id,{zone:'deck'});g.moveCard(next.id,{zone:'hand',playerId:id});}g.deck.reverse();
 // Fixture card moves can add no public reveals, but their count history differs;
 // restore the same public evidence to isolate inaccessible faces.
 g.publicHistory.events=structuredClone(obs.publicHistory.events);
 assert.deepEqual(policy.rankAiActions(g,0),before);
});

test('no cleansing target grants no bond value; unknown overflow cannot guarantee a gifted wind survives',()=>{
 const g=make();const wind=take(g,0,c=>c.elements.includes('wind'));const s=model(g);transfer(s,0,3,s.players[0].hand[0]);
 assert.equal(giftOptionValue(s,s.players[3]),0);
 s.players[3].limit=0;overflow(s,3);assert.equal(s.players[3].known.length,0);assert.equal(giftOptionValue(s,s.players[3]),0);
});
test('real snipe blocks imminent fifth cup, and real low-morale overflow can lose after buying',async()=>{
 const g=new Game({heroIds:['marksman','none','none','none','none','none']});g.player(0).energy.crystal=1;
 g.addStones('blue','gem',3);g.teams.blue.cups=4;g.startTurn(0);
 await g.executeAction(0,{type:'skill',skillId:'snipe',cardIds:[],targetIds:[1]});g.skipExtraActions(0);g.endTurn();g.startTurn(1);
 assert.equal(g.player(1).hand.length,5);assert.equal(g.canDrawSpecial(1),false);assert.throws(()=>g.synthesize(1,3));
 const h=new Game({heroIds:Array(6).fill('none')});for(let i=0;i<3;i++)take(h,0,c=>c.name==='holyLight');h.teams.red.morale=1;h.startTurn(0);await h.executeAction(0,{type:'purchase'});h.endTurn();h.startTurn(1);
 const fire=take(h,1,c=>c.type==='attack');await h.executeAction(1,{type:'play',index:h.player(1).hand.indexOf(fire),targetId:0},{chooseResponse:()=>null,overflow:'ai'});assert.equal(h.winner,'blue');
});
test('risk requires an intervening threat; distant response opportunity is not a guaranteed synthesis',async()=>{
 const s=model(make());s.teams.blue.morale=1;s.players[1].count=6;assert.equal(drawDanger(s,s.players[1]),0);
 s.players[5].count=6;s.players[3].count=3;assert.ok(drawDanger(s,s.players[5])>0);
 const g=new Game({heroIds:Array(6).fill('none')});const atk=take(g,0,c=>c.type==='attack');for(let i=0;i<4;i++)take(g,1,c=>c.name==='holyLight');g.addStones('blue','gem',3);g.teams.blue.cups=4;g.startTurn(0);
 await g.executeAction(0,{type:'play',index:0,targetId:1},{chooseResponse:()=>({index:0})});g.endTurn();g.startTurn(1);assert.equal(g.player(1).hand.length,3);assert.equal(g.canDrawSpecial(1),true);await g.executeAction(1,{type:'synthesize',gemCount:3});assert.equal(g.winner,'blue');
});
test('real full resource pool wastes hit gain; synthesis releases capacity only for later actions',async()=>{
 const g=new Game({heroIds:Array(6).fill('none')});g.addStones('red','gem',5);take(g,0,c=>c.type==='attack');g.startTurn(0);await g.executeAction(0,{type:'play',index:0,targetId:1},{chooseResponse:()=>null});assert.equal(g.stoneCounts('red').total,5);assert.equal(g.canDrawSpecial(0),false);g.endTurn();
 g.startTurn(3);await g.executeAction(3,{type:'synthesize',gemCount:3});assert.equal(g.stoneCounts('red').total,2);g.endTurn();take(g,4,c=>c.type==='attack');g.startTurn(4);await g.executeAction(4,{type:'play',index:0,targetId:2},{chooseResponse:()=>null});assert.equal(g.stoneCounts('red').total,3);
});
test('cleansing option retains the cost of removing friendly shield or enemy poison',()=>{
 for(const [name,target] of [['holyShield',3],['poison',1]]){
  const g=make(),wind=take(g,0,c=>c.elements.includes('wind')),effect=g.deck.find(c=>c.name===name);g.attachCard(effect.id,target,{effectId:name,sourcePlayerId:0});
  const s=model(g);transfer(s,0,3,s.players[0].hand.find(c=>c.id===wind.id));assert.equal(giftOptionValue(s,s.players[3]),0,name);
 }
});
test('priest personal water option is not counted twice; transferred water has recipient capability value',()=>{
 const g=make();take(g,0,c=>c.elements.includes('water'));take(g,0,c=>c.type==='attack');const s=model(g);
 assert.equal(giftOptionValue(s,s.players[0]),0);
 const recipient=s.players[3];recipient.skillIds=['waterPower'];recipient.hero='priest';recipient.count=1;transfer(s,0,3,s.players[0].hand[0]);assert.ok(giftOptionValue(s,recipient)>0);
});
test('public healing can preserve an imminent fifth cup: model matches candidate real response',async()=>{
 const g=new Game({seed:914,heroIds:Array(6).fill('none')});take(g,0,c=>c.type==='attack');for(let i=0;i<3;i++)take(g,1,c=>c.name==='holyLight');for(const id of [2,5])for(let i=0;i<6;i++)take(g,id,c=>c.type==='attack');
 g.player(1).healing=2;g.addStones('blue','gem',3);g.teams.blue.cups=4;g.startTurn(0);
 const s=model(g);damage(s,1,2,'attack');assert.equal(s.players[1].count,3);assert.equal(s.players[1].healing,0);
 let selected;await g.executeAction(0,{type:'play',index:0,targetId:1},{chooseResponse:()=>null,choose:r=>{const v=policy.chooseAiRuleDecision(r,g);if(r.type==='healing')selected=v;return v;}});
 assert.equal(selected,2);assert.equal(g.player(1).hand.length,s.players[1].count);g.endTurn();g.startTurn(1);const a=policy.chooseAiAction(g,1);assert.equal(a.type,'synthesize');await g.executeAction(1,a);assert.equal(g.winner,'blue');
});
test('healing preservation respects public cups, resources, available amount and priest cap',()=>{
 const base=model(make());base.players[1].count=3;base.players[1].healing=2;base.teams.blue.cups=4;base.teams.blue.gem=3;
 for(const condition of ['notFourth','poor','insufficient','priest']){
  const s=clone(base);if(condition==='notFourth')s.teams.blue.cups=3;if(condition==='poor')s.teams.blue.gem=2;if(condition==='insufficient')s.players[1].healing=1;if(condition==='priest')s.players[1].hero='priest';
  damage(s,1,2,'attack');assert.ok(s.players[1].count>3,condition);
 }
 const s=clone(base);s.players[1].count=6;damage(s,1,2,'attack');assert.equal(s.players[1].count,6);assert.equal(s.players[1].healing,0);
});
