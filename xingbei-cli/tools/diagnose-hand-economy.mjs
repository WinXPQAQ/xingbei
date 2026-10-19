// Deterministic constructed diagnostics, NOT reconstruction of user screenshots.
// Never changes production policies. Records scores rather than asserting a new policy.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {Game} from '../src/engine.js';
import {getPolicy} from '../src/ai/versions.js';
import {captureObservation,observationView} from '../src/ai/observation.js';
import {cardScore} from '../src/ai/v1.0/evaluation.js';
const output=process.argv[2]??'/tmp/hand-economy.json';
const versions=['v1.0','v1.1','v1.2','defense-1','all-1'];
const make=hero=>new Game({seed:19,shuffleDeck:false,playerHeroId:hero});
const take=(g,id,predicate)=>{const c=g.deck.find(typeof predicate==='string'?c=>c.name===predicate:predicate);assert.ok(c,'fixture card');return g.moveCard(c.id,{zone:'hand',playerId:id});};
const plain=(g,id,name)=>take(g,id,c=>c.name===name&&!c.uniqueSkills.some(s=>['flashTrap','precisionShot','fireSeal','waterSeal','earthSeal','windSeal','thunderSeal'].includes(s)));
const fill=(g,id,count)=>{while(g.player(id).hand.length<count)take(g,id,c=>c.type==='attack');};
const opponents=(g,n)=>[1,2,5].forEach(id=>fill(g,id,n));
function ranked(g) {
 return Object.fromEntries(versions.map(v=>[v,getPolicy(v).rankAiActions(g,0).slice(0,12).map(e=>({...e,card:e.action.type==='play'?g.player(0).hand[e.action.index].toJSON():null}))]));
}
const cases=[];
{
 const g=make('sealer');take(g,0,'darkStrike');plain(g,0,'fireStrike');plain(g,0,'fireStrike');plain(g,0,'earthStrike');opponents(g,3);
 cases.push({id:'dark-versus-three',own:g.player(0).hand.map(c=>c.toJSON()),rank:ranked(g)});
 fill(g,1,6);cases.push({id:'dark-full-target-counterexample',rank:ranked(g)});
}
{
 const g=make('marksman');for(let n=0;n<3;n++)plain(g,0,'fireStrike');for(let n=0;n<2;n++)plain(g,0,'windStrike');
 const precision=take(g,0,c=>c.element==='earth'&&c.hasUniqueSkill('precisionShot'));opponents(g,4);
 cases.push({id:'precision-three-fire-two-wind-one-earth-CONSTRUCTED',own:g.player(0).hand.map(c=>c.toJSON()),rank:ranked(g),precisionResponseLegal:g.canRespond(g.player(1).hand[0],precision)});
 // Explicit earth incoming proves the response option, independent of fixture enemy card.
 const earth=g.deck.find(c=>c.name==='earthStrike');assert.equal(g.canRespond(earth,precision),true);
 fill(g,1,6);cases.push({id:'precision-overflow-counterexample',rank:ranked(g)});
}
{
 const g=make('marksman');for(let n=0;n<3;n++)plain(g,0,'fireStrike');for(let n=0;n<3;n++)plain(g,0,'windStrike');opponents(g,3);g.addStones('red','crystal',2);
 cases.push({id:'full-hand-refine',rank:ranked(g)});
 assert.equal(getPolicy('v1.2').chooseAiAction(g,0).type,'refine');
 const before=getPolicy('v1.2').rankAiActions(g,0);const seal=g.deck.find(c=>c.hasUniqueSkill('fireSeal'));g.attachCard(seal.id,0,{effectId:'fireSeal',sourcePlayerId:1});
 const after=getPolicy('v1.2').rankAiActions(g,0);
 assert.deepEqual(after,before);cases.push({id:'own-fire-seal-not-priced',rankUnchanged:true,rank:ranked(g)});
}
{
 const g=new Game({seed:19,shuffleDeck:false,heroIds:['priest','berserker','sealer','marksman','guardianAngel','windSwordmaster']});
 plain(g,0,'waterStrike');plain(g,0,'fireStrike');take(g,0,'holyLight');fill(g,3,5);fill(g,4,6);opponents(g,3);
 const own=g.player(0).hand,water=own[0],fire=own[1];
 const gift=()=>getPolicy('v1.2').giftScore(g,0,3,fire);
 const before=gift(),rankBefore=ranked(g);
 const seal=g.deck.find(c=>c.hasUniqueSkill('fireSeal'));g.attachCard(seal.id,3,{effectId:'fireSeal',sourcePlayerId:2});
 assert.equal(gift(),before);
 cases.push({id:'gift-to-five-card-marksman-with-fire-seal',fireGiftScore:before,sealDoesNotChangeGiftScore:true,rankBefore,rankAfter:ranked(g)});
 const dto=captureObservation(g,0,{actions:true}),v=observationView(dto);
 assert.deepEqual(Object.keys(v.player(3).hand),['length']);
 const hiddenBefore=g.player(3).hand.map(c=>c.id),history=g.publicHistory.events.map(e=>({...e})),seq=g.publicHistory.sequence;
 for(const c of [...g.player(3).hand])g.moveCard(c.id,{zone:'deck'});
 for(let n=0;n<5;n++)take(g,3,c=>!hiddenBefore.includes(c.id));
 g.publicHistory.events=history;g.publicHistory.sequence=seq;
 assert.deepEqual(captureObservation(g,0,{actions:true}),dto);assert.equal(gift(),before);
 cases.push({id:'support-hidden-teammate-permutation',sameObservation:true,sameGiftScore:true});
 for(let i=0;i<3;i++)g.publicHistory.append({type:'unanswered',playerId:1,elements:['fire'],acceptCost:2});
 assert.equal(gift(),before);cases.push({id:'public-fire-gap-not-used-by-gift',sameGiftScore:true});
 // Genuine execution of waterPower with the policy choosing a gift, not a fabricated outcome.
 const selected=getPolicy('v1.2').rankAiActions(g,0).find(e=>e.action.skillId==='waterPower'&&e.action.targetIds[0]===3&&e.action.cardIds[0]===water.id);
 const counts=[g.player(0).hand.length,g.player(3).hand.length];g.startTurn(0);
 await g.executeAction(0,selected.action,{choose:r=>getPolicy('v1.2').chooseAiRuleDecision(r,g),overflow:'ai'});
 g.assertCardLocations();cases.push({id:'water-power-real-execution',beforeCounts:counts,afterCounts:[g.player(0).hand.length,g.player(3).hand.length],giftedFire:g.player(3).hand.some(c=>c.id===fire.id),healing:[g.player(0).healing,g.player(3).healing]});
}
{
 const g=make('marksman');const bullet=take(g,0,'magicBullet');for(let n=0;n<5;n++)plain(g,0,n%2?'fireStrike':'windStrike');fill(g,1,3);
 const request={type:'cardChoice',playerId:0,skillId:'piercingShot',count:1,valid:[0],optional:true,context:{targetId:1}};
 const choices=()=>Object.fromEntries(versions.map(v=>[v,getPolicy(v).chooseAiRuleDecision(request,g)]));
 assert.equal(getPolicy('v1.2').chooseAiRuleDecision(request,g),null);
 cases.push({id:'piercing-zero-morale-hard-veto',ownCount:6,targetCount:3,choices:choices(),bulletScore:getPolicy('v1.2').cardScore(g,0,bullet,g.player(0).hand.slice(1))});
 fill(g,1,6);assert.deepEqual(getPolicy('v1.2').chooseAiRuleDecision(request,g),[0]);cases.push({id:'piercing-overflow-counterexample',choices:choices()});
}
{
 const g=make('sealer');take(g,0,'darkStrike');take(g,0,'holyLight');take(g,0,'holyLight');opponents(g,3);g.startTurn(0);
 g.turn.state.completed=true;g.turn.state.actionType='spell';g.turn.state.pendingActions=[{type:'attack',element:null,sourceSkillId:'spellExcitation'}];
 const scores=getPolicy('v1.2').rankAiActions(g,0);assert.equal(scores[0].action.type,'play');
 g.teams.red.morale=1;assert.deepEqual(getPolicy('v1.2').rankAiActions(g,0),scores);
 cases.push({id:'optional-extra-dark-only-attack-versus-three',ownMoraleDoesNotChangeScore:true,rank:ranked(g)});
}
{
 const g=make('marksman');take(g,0,'magicBullet');const fire=plain(g,0,'fireStrike');plain(g,0,'windStrike');opponents(g,3);
 const v=observationView(captureObservation(g,0)),c=v.cards.get(fire.id),hand=v.player(0).hand;
 const full=cardScore(v,0,c,hand.filter(x=>x!==c)),attacksOnly=cardScore(v,0,c,hand.filter(x=>x!==c&&x.type==='attack'));
 assert.equal(full,attacksOnly);cases.push({id:'no-spell-complement-value-in-attack-retention',full,attacksOnly,note:'Current cardScore attack formula ignores remaining spell complement; filtered hand alone is not a numerical regression for that formula.'});
}
{
 const g=new Game({seed:19,shuffleDeck:false,heroIds:['priest','berserker','sealer','marksman','guardianAngel','windSwordmaster']});
 const water=take(g,0,c=>c.name==='poison'&&c.element==='water'),fire=plain(g,0,'fireStrike');fill(g,3,5);g.player(0).healing=1;g.player(3).healing=1;
 g.startTurn(0);await g.executeAction(0,{type:'skill',skillId:'waterPower',cardIds:[water.id],targetIds:[3]},{choose:r=>getPolicy('v1.2').chooseAiRuleDecision(r,g),overflow:'ai'});
 assert.ok(g.player(3).hand.some(c=>c.id===fire.id));g.assertCardLocations();
 cases.push({id:'constructed-water-poison-cost-fire-transfer',ownCount:g.player(0).hand.length,recipientCount:g.player(3).hand.length,healing:[g.player(0).healing,g.player(3).healing],note:'Constructed 2/5-hand inputs, not known screenshot counts. Donor gains room, recipient reaches six; net value is not established by this fact alone.'});
}

{
 const traces=[];
 for(const sealed of [false,true]) {
  const g=make('marksman'),fire=plain(g,0,'fireStrike');
  for(let n=0;n<5;n++)plain(g,0,'windStrike');take(g,1,'holyLight');fill(g,1,3);
  g.player(0).healing=2;
  if(sealed){const c=g.deck.find(c=>c.hasUniqueSkill('fireSeal'));g.attachCard(c.id,0,{effectId:'fireSeal',sourcePlayerId:1});}
  const p=getPolicy('v1.2'),before={hand:6,healing:2,morale:g.teams.red.morale};g.startTurn(0);
  await g.executeAction(0,{type:'play',index:g.player(0).hand.indexOf(fire),targetId:1},{choose:r=>p.chooseAiRuleDecision(r,g),chooseResponse:r=>p.chooseAiResponse(g,r),overflow:'ai'});
  g.assertCardLocations();traces.push({sealed,before,after:{hand:g.player(0).hand.length,healing:g.player(0).healing,morale:g.teams.red.morale,seal:g.player(0).getStatus('fireSeal').length,targetHand:g.player(1).hand.length},log:g.log});
 }
 assert.equal(traces[0].after.hand,5);assert.equal(traces[1].after.hand,6);assert.equal(traces[1].after.healing,0);assert.equal(traces[1].after.seal,0);
 cases.push({id:'sealed-fire-real-execution-counterfactual',note:'Forced legal fire action to trace engine costs, not an optimal-action claim or screenshot reconstruction. Opponent response is chosen by v1.2.',traces});
}
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify({scope:'constructed deterministic states, not screenshots; observations use own hand and public facts',versions,cases},null,2));
console.log(JSON.stringify({output,cases:cases.length,assertions:'passed',top:cases.filter(c=>c.rank).map(c=>({id:c.id,choices:Object.fromEntries(Object.entries(c.rank).map(([v,r])=>[v,{action:r[0].action,score:r[0].score,card:r[0].card?.name}]))}))},null,2));
