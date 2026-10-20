import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {Game} from '../src/engine.js';import {getPolicy} from '../src/ai/versions.js';import {captureObservation,observationView} from '../src/ai/observation.js';
import {stateOf,clone,value,components,energyPlan,transfer,damage} from '../src/ai/v1.5-candidate/model.js';
import {actionPlan,attackBranches,explain} from '../src/ai/v1.5-candidate/planner.js';
const policy=getPolicy('experimental/plans-1');
const take=(g,id,pred)=>{const c=g.deck.find(pred);assert(c);g.moveCard(c.id,{zone:'hand',playerId:id});return c;};
const model=(g,id=0)=>stateOf(observationView(captureObservation(g,id)),id);
const cases=JSON.parse(fs.readFileSync(new URL('../artifacts/ai/targeted-fixes-1/negative-cases.json',import.meta.url))).cases;
test('v15 five old cases retain legal complete rankings and finite decomposed scores; no prescribed ordering',()=>{
 for(const c of cases){const s=stateOf(observationView(c.observation),c.actorId);for(const {action}of c.ranked){const plan=actionPlan(s,c.actorId,action),e=explain(s,plan);assert(Number.isFinite(plan.score));assert(Math.abs(plan.score-Object.values(e.parts).reduce((a,b)=>a+b,0))<1e-7);assert((plan.search?.used??0)<=128);}}
});
test('v15 shield + free attack is a complete engine plan; shield consumed means prevention, no fixed consumption bonus',async()=>{
 const g=new Game({heroIds:['sealer',...Array(5).fill('none')]});const shield=take(g,0,c=>c.name==='holyShield');take(g,0,c=>c.name==='fireStrike');take(g,0,c=>c.name==='waterStrike');take(g,1,c=>c.name==='fireStrike');g.startTurn(0);
 await g.executeAction(0,{type:'play',index:g.player(0).hand.indexOf(shield),targetId:3},{choose:r=>r.skillId==='spellExcitation'});
 assert(g.turn.hasExtraActions());const before=g.player(3).hand.length;
 await g.executeAction(0,{type:'play',index:0,targetId:1},{chooseResponse:r=>r.target.id===1?{index:0,targetId:3}:null,choose:()=>false});
 assert.equal(g.player(3).hand.length,before);assert.equal(g.player(3).getStatus('holyShield').length,0);
 const events=g.publicHistory.actions;assert(events.some(e=>e.type==='attack'&&e.actorId===0&&e.targetId===1&&e.card==='fireStrike'));assert(events.some(e=>e.type==='response'&&e.result==='redirect'&&e.targetId===3));assert(events.some(e=>e.type==='attackResult'&&e.actorId===1&&e.targetId===3&&e.result!=='hit'));
 assert(events.some(e=>e.type==='skillResponse'&&e.skillId==='spellExcitation'&&e.accepted));
 const c=cases[3],s=stateOf(observationView(c.observation),c.actorId),plan=actionPlan(s,c.actorId,{type:'play',index:1,targetId:3});assert(plan.branches.some(b=>b.steps.some(step=>step.type==='attack')));assert(plan.score>0);assert(!('shieldConsumedReward'in components(s)));
});
test('v15 energy has typed realizable uses and batching, not rewards for unusable crystals',()=>{
 const g=new Game({heroIds:['berserker','none','none','windSwordmaster','marksman','none']});for(let i=0;i<4;i++)take(g,0,c=>c.type==='attack');g.startTurn(0);const s=model(g),p=s.players[0];p.energy.crystal=2;assert.equal(energyPlan(s,p),0);p.energy.crystal=0;p.energy.gem=1;const one=energyPlan(s,p);p.energy.gem=2;assert(energyPlan(s,p)>one+5);p.hand=[];p.count=0;assert.equal(energyPlan(s,p),0);
});
test('v15 waterPower chooses applicable magic gift to sealer and resolves actual gift before overflow',async()=>{
 const g=new Game({heroIds:['priest','none','none','sealer','guardianAngel','none']});const water=take(g,0,c=>c.elements.includes('water'));const magic=take(g,0,c=>c.name==='magicBullet');take(g,0,c=>c.type==='attack');take(g,0,c=>c.type==='attack');for(let i=0;i<3;i++)take(g,3,c=>c.type==='attack');g.startTurn(0);
 await g.executeAction(0,{type:'skill',skillId:'waterPower',cardIds:[water.id],targetIds:[3]},{choose:r=>policy.chooseAiRuleDecision(r,g)});
 assert(g.player(3).hand.some(c=>c.id===magic.id));assert.equal(g.player(3).healing,1);assert.equal(g.player(0).healing,1);
 const publicEvents=captureObservation(g,1).publicHistory.actions;assert(publicEvents.some(e=>e.type==='give'&&e.count===1));assert(!JSON.stringify(publicEvents).includes(magic.id));
});
test('v15 uncertainty terminal bounded across attack and magic; confirmed fifth cup retains priority',()=>{
 const c=cases[1],s=stateOf(observationView(c.observation),c.actorId);for(const r of c.ranked){const p=actionPlan(s,c.actorId,r.action);assert(Math.abs(explain(s,p).parts.terminal)<=150);assert(Math.abs(explain(s,p).parts.futureTerminal)<=300);}
 const g=new Game({heroIds:Array(6).fill('none')});g.addStones('red','gem',3);g.teams.red.cups=4;g.startTurn(0);const plan=actionPlan(model(g),0,{type:'synthesize',gemCount:3});assert(plan.score>90000);
 const known=model(g);known.teams.blue.morale=0;assert(components(known).terminal>=100000);known.uncertain=true;assert.equal(components(known).terminal,150);
});
test('v15 fifth-cup windows respond to 4/4/5, 4/4/3, order, healing and direct win',()=>{
 const g=new Game({heroIds:Array(6).fill('none')});take(g,0,c=>c.name==='fireStrike');for(const [id,count]of [[1,4],[2,4],[5,5]])for(let i=0;i<count;i++)take(g,id,c=>c.type==='attack');g.addStones('blue','gem',3);g.teams.blue.cups=4;g.startTurn(0);const s=model(g),card=s.players[0].hand[0];
 const four=actionPlan(s,0,{type:'play',index:0,targetId:1}),five=actionPlan(s,0,{type:'play',index:0,targetId:5});assert(five.score>four.score);
 s.players[5].count=3;const three=actionPlan(s,0,{type:'play',index:0,targetId:5});assert(three.score>actionPlan(s,0,{type:'play',index:0,targetId:1}).score);
 const before=components(s).cupWindow;s.current=4;assert(components(s).cupWindow<before);s.players[5].healing=2;const healed=clone(s);damage(healed,5,2,'attack');assert.equal(healed.players[5].count,3);assert.equal(healed.players[5].healing,0);
});
test('v15 hidden information invariance covers all six observers including semantic history',()=>{
 for(let id=0;id<6;id++){const g=new Game({seed:1504001}).setup();g.current=id;g.startTurn(id);g.recordPublicAction({type:'attack',actorId:1,targetId:3,card:'fireStrike',elements:['fire'],counter:false});const before=captureObservation(g,id,{actions:true}),ranked=policy.rankAiActions(g,id),history=structuredClone(g.publicHistory);for(const p of g.players.filter(p=>p.id!==id)){const old=[...p.hand];for(const c of old)g.moveCard(c.id,{zone:'deck'});for(let n=0;n<old.length;n++)g.moveCard(g.deck[0].id,{zone:'hand',playerId:p.id});}g.deck.reverse();Object.assign(g.publicHistory,history);g.revealHiddenLogs=true;assert.deepEqual(captureObservation(g,id,{actions:true}),before);assert.deepEqual(policy.rankAiActions(g,id),ranked);}
});
test('v15 declined private skill offers and covered costs do not publish hidden traits',()=>{
 const g=new Game({heroIds:['windSwordmaster',...Array(5).fill('none')]});const wind=take(g,0,c=>c.elements.includes('wind'));const offer=g.offerSkill(0,'windFury','风怒追击');offer.next();offer.next(false);assert(!g.publicHistory.actions.some(e=>e.skillId==='windFury'));
 g.discardCards(0,[wind],{visibility:'public',covered:true});const event=g.publicHistory.actions.find(e=>e.type==='discard');assert.deepEqual(Object.keys(event).sort(),['count','playerId','sequence','type']);
});
test('v15 refinement compares shared gem opportunity, two useful charges, capacity and unusable charge',()=>{
 const g=new Game({heroIds:['windSwordmaster','none','none','berserker','priest','none']});for(let i=0;i<4;i++)take(g,0,c=>c.type==='attack');for(let i=0;i<4;i++)take(g,3,c=>c.type==='attack');g.addStones('red','gem',2);g.addStones('red','crystal',2);g.startTurn(0);let s=model(g);
 const score=(gem,crystal)=>actionPlan(s,0,{type:'refine',stones:{gem,crystal}}).score;
 assert(score(0,2)>score(2,0),'wind leaves gems for gem-only ally');s.players[4].count=4;assert(score(0,2)>score(0,1),'two evidenced uses amortize refinement when no ally has immediate synthesis');
 g.player(0).energy.crystal=2;assert(policy.rankAiActions(g,0).filter(r=>r.action.type==='refine').every(r=>r.action.stones.gem+r.action.stones.crystal===1));
 s.players[0].hero='berserker';assert(score(1,0)>score(0,1));assert(score(1,0)>score(1,1),'do not fill capacity with unusable crystal');
});
test('v15 real magic relay records sources, cancellation and public settlement without hidden gifts',async()=>{
 const g=new Game({heroIds:['sealer',...Array(5).fill('none')]});take(g,0,c=>c.name==='magicBullet');const first=g.magicTarget(0,new Set([0])).id;take(g,first,c=>c.name==='magicBullet');const second=g.magicTarget(first,new Set([0,first])).id;take(g,second,c=>c.name==='holyLight');g.startTurn(0);
 await g.executeAction(0,{type:'play',index:0,targetId:first},{chooseResponse:()=>({index:0}),choose:()=>false});
 const events=g.publicHistory.actions;assert(events.some(e=>e.type==='magic'&&e.actorId===0&&e.targetId===first));assert(events.some(e=>e.type==='magic'&&e.actorId===first&&e.targetId===second&&e.amount===3));assert(events.some(e=>e.type==='response'&&e.actorId===second&&e.result==='cancel'));assert(!events.some(e=>e.type==='damage'));
});
