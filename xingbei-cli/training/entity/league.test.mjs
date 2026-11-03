import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../src/engine.js';
import { HERO_IDS, roster } from './rosters.mjs';
import { encodeEntities } from './observation.mjs';
import { heroFields, declaredState } from './hero-state.mjs';
import { driveGame } from '../driver.mjs';
import { teacherIndex } from '../teacher.mjs';
import { boundaryState, digest } from './replay.mjs';

test('72 heroes balanced; hidden hands and deck do not change observations',()=>{
 const counts=new Map(HERO_IDS.map(h=>[h,Array(6).fill(0)]));
 for(let i=0;i<2400;i++){const ids=roster(i);assert.equal(new Set(ids).size,6);ids.forEach((h,s)=>counts.get(h)[s]++);}
 for(const c of counts.values()){assert.equal(c.reduce((a,b)=>a+b),200);assert.ok(Math.max(...c)-Math.min(...c)<=1);}
 for(let i=0;i<12;i++){
  const game=new Game({seed:991103000+i,heroIds:roster(i)}).setup();
  for(let seat=0;seat<6;seat++){
   const input={game,playerId:seat,request:{type:'skillChoice'},candidates:[true,false]};
   const before=JSON.stringify(encodeEntities(input));
   // Reorder hidden zones without invoking public game events.
   for(const p of game.players)if(p.id!==seat)p.hand.reverse();
   game.deck.reverse();
   assert.equal(JSON.stringify(encodeEntities(input)),before);
   const visible=declaredState(game.player(seat),seat);
   assert.equal(visible.length,Object.keys(heroFields[game.player(seat).hero.id]).length);
  }
 }
});

test('real boundary replay restores full state before any learned decision',async()=>{
 const config={seed:731103000,heroIds:roster(0),capture:true,revision:'test'};
 const teacher=input=>teacherIndex(input,'v1.9.0-preview.1');
 const original=await driveGame(config,teacher);
 assert.ok(original.boundaries.length);
 const boundary=original.boundaries[0];let restored=false, decisions=0;
 const result=await driveGame({...config,replay:boundary},input=>{assert.ok(restored);decisions++;return teacher(input);},game=>{
  restored=true;assert.equal(digest(boundaryState(game)),boundary.hash);
  for(let seat=0;seat<6;seat++)encodeEntities({game,playerId:seat,request:{type:'skillChoice'},candidates:[true,false]});
 });
 assert.ok(decisions>0);assert.equal(result.winner,original.winner);assert.equal(result.decisions,original.decisions);
 assert.equal(result.replayedDecisions,boundary.choices.length);
 await assert.rejects(driveGame({...config,replay:{...boundary,hash:'invalid'}},teacher),/boundary mismatch/);
});

test('voluntary trueShadow exhausting the last two cards forfeits instead of stalling',async()=>{
 const ids=roster(0);ids[0]='headMaid';
 const game=new Game({seed:991103111,heroIds:ids}).setup();
 for(const c of [...game.player(0).hand])game.moveCard(c.id,{zone:'outside'});
 for(const c of game.deck.filter(c=>c.type==='attack').slice(0,2))game.moveCard(c.id,{zone:'hand',playerId:0});
 game.player(0).energy.gem=1;
 const choose=request=>request.type==='skillChoice' ? request.skillId==='trueShadow' : request.type==='cardChoice' ? request.valid.slice(0,request.count) : request.defaultValue;
 await game.beginTurn(0,{choose});
 try{await game.executeAction(0,{type:'play',index:0,targetId:1},{choose});}catch(error){assert.ok(error.actionInvalidated);}
 assert.equal(game.winner,'blue');assert.equal(game.player(0).hand.length,0);
 assert.ok(game.log.some(line=>line.includes('恶意无法行动')));
});
