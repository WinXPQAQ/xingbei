import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Game } from '../src/engine.js';
import * as production from '../src/ai.js';
import { getPolicy } from '../src/ai/versions.js';
import { PublicHistory, publicBeliefs } from '../src/ai/public-history.js';
import { hitEstimate } from '../src/ai/v1.1/reading.js';
import { mirrorRoster, schedule, playMatch, summary, lineups } from '../tools/ai/evaluate.mjs';

const take = (game, id, name) => game.moveCard(game.deck.find(c => c.name === name).id, {zone:'hand',playerId:id});

test('v1.0 frozen module hashes and disabled reading preserve the original policy', () => {
  const hashes=JSON.parse(readFileSync(new URL('../src/ai/v1.0/manifest.json',import.meta.url)));
  for(const [name,hash] of Object.entries(hashes.files)) assert.equal(createHash('sha256').update(readFileSync(new URL(`../src/ai/v1.0/${name}`,import.meta.url))).digest('hex'),hash);
  for(const hero of Object.values(lineups).flat()) {
    const game=new Game({seed:32,playerHeroId:hero}).setup();
    assert.deepEqual(getPolicy('v1.0').chooseAiAction(game,0),production.chooseAiAction(game,0));
    assert.deepEqual(getPolicy('read-off').chooseAiAction(game,0),production.chooseAiAction(game,0));
    assert.equal(getPolicy('read-1').chooseAiResponse,getPolicy('v1.0').chooseAiResponse);
    assert.equal(getPolicy('read-1').chooseAiRuleDecision,getPolicy('v1.0').chooseAiRuleDecision);
    assert.equal(getPolicy('read-1').chooseAiDiscard,getPolicy('v1.0').chooseAiDiscard);
  }
});

test('response rules: dark wildcard, dark attack, holy light, and actual trait intersection',()=>{
  const g=new Game({heroRules:false});const fire=take(g,0,'fireStrike'),water=take(g,1,'waterStrike'),dark=take(g,1,'darkStrike'),light=take(g,1,'holyLight');
  assert.equal(g.canRespond(fire,water),false);assert.equal(g.canRespond(fire,dark),true);
  assert.equal(g.canRespond(dark,fire),false);assert.equal(g.canRespond(dark,light),true);
});

test('public evidence is soft, expires on draws/discards/turns, and excludes forced/uncounterable hits',()=>{
  const g=new Game({heroRules:false}),fire=take(g,0,'fireStrike');take(g,1,'waterStrike');take(g,1,'waterStrike');
  const prior=hitEstimate(g,0,fire,1);
  const event={targetId:1,card:fire,attackTraits:{elements:['fire']},canCounter:true};
  g.publicHistory.attack(event);const learned=hitEstimate(g,0,fire,1);
  assert.ok(learned>prior && learned<1);
  const before=g.publicHistory.sequence;g.publicHistory.attack({...event,forcedHit:true});g.publicHistory.attack({...event,canCounter:false});assert.equal(g.publicHistory.sequence,before);
  const gap=publicBeliefs(g).get(1).fire;
  g.publicHistory.move({zone:'deck'},{zone:'hand',playerId:1});assert.ok(publicBeliefs(g).get(1).fire<gap);
  const next=publicBeliefs(g).get(1).fire;
  g.publicHistory.move({zone:'hand',playerId:1},{zone:'discard'});g.publicHistory.append({type:'turn'});assert.ok(publicBeliefs(g).get(1).fire<next);
  for(let i=0;i<300;i++)g.publicHistory.append({type:'turn'});
  assert.equal(publicBeliefs(g).get(1),undefined);assert.equal(g.publicHistory.events.length,256);
});

test('private movements expose only counts; public plays expose immutable traits, never snapshots',()=>{
  const g=new Game({heroRules:false});const fire=take(g,0,'fireStrike');
  const gain=g.publicHistory.events.at(-1);assert.deepEqual(Object.keys(gain).sort(),['playerId','sequence','type']);
  g.discardCards(0,[fire],{visibility:'hidden'});
  assert.equal(g.publicHistory.events.at(-1).elements,null);
  const water=take(g,0,'waterStrike');g.playCard(g.player(0),0);
  assert.deepEqual(g.publicHistory.events.at(-1).elements,['water']);
  assert.ok(Object.isFrozen(g.publicHistory.events.at(-1).elements));
  assert.ok(!JSON.stringify(g.publicHistory.events).includes(water.id));
});

test('reading changes equal target rankings on public evidence without altering defense or rules',()=>{
  const g=new Game({heroRules:false});const fire=take(g,0,'fireStrike');
  for(const id of [1,2,5]){take(g,id,'waterStrike');take(g,id,'waterStrike');}
  const scores=()=>getPolicy('read-1').rankAiActions(g,0).filter(e=>e.action.type==='play');
  assert.equal(scores()[0].action.targetId,1);
  g.publicHistory.attack({targetId:5,card:fire,attackTraits:{elements:['fire']},canCounter:true});
  assert.equal(scores()[0].action.targetId,5);
  assert.equal(getPolicy('v1.0').rankAiActions(g,0).filter(e=>e.action.type==='play')[0].action.targetId,1);
});

test('all six heroes: policy cannot inspect other hands, hidden registry, deck, logs or presentation snapshots',()=>{
  for(const hero of new Set(Object.values(lineups).flat())) {
    const g=new Game({seed:40,playerHeroId:hero}).setup();
    const expected=getPolicy('read-1').rankAiActions(g,0);
    const deny=()=>{throw new Error('Hidden information read')};
    const protect=a=>new Proxy(a,{get:(t,k)=>k==='length'?t.length:deny()});
    for(const p of g.players.slice(1))p.hand=protect(p.hand);
    g.deck=protect(g.deck);g.discard=protect(g.discard);g.random=deny;
    const cards=g.cards;g.cards={get(id){const c=cards.get(id);if(c && (c.location.zone==='status'||c.location.zone==='outside'||(c.location.zone==='hand'&&c.location.playerId===0)))return c;return deny();}};
    Object.defineProperty(g,'log',{get:deny});Object.defineProperty(g,'presentationEvents',{get:deny});
    assert.deepEqual(getPolicy('read-1').rankAiActions(g,0),expected);
  }
});

test('mirror schedule pairs seed, lineup and start identically, with both policy colors',()=>{
  const rows=schedule({firstSeed:17,seeds:2});assert.equal(rows.length,48);
  for(const heroes of Object.values(lineups))for(let r=0;r<3;r++){
    const ids=mirrorRoster(heroes,r);assert.deepEqual([ids[0],ids[3],ids[4]],[ids[1],ids[2],ids[5]]);
  }
  for(let i=0;i<rows.length;i+=2)assert.deepEqual({...rows[i],team:'blue'},rows[i+1]);
});

test('baseline selfplay is identical under policy-label exchange, with all decisions routed',async()=>{
  const rows=schedule({firstSeed:73,seeds:1,selected:['support']});const results=[];
  for(const row of rows)results.push(await playMatch(row,{candidate:'v1.0',opponent:'v1.0'}));
  for(let i=0;i<results.length;i+=2){assert.deepEqual(results[i].initial,results[i+1].initial);assert.equal(results[i].winner,results[i+1].winner);assert.equal(results[i].turns,results[i+1].turns);}
  const s=summary(results);assert.equal(s.scoreRate,0.5);assert.equal(s.truncated,0);assert.deepEqual(s.clusterBootstrap95,[0.5,0.5]);
});
