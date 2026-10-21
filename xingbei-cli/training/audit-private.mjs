import assert from 'node:assert/strict';
import {driveGame} from './driver.mjs';
import {encodeDecision} from './observation.mjs';
import {actionCandidates} from './candidates.mjs';
let state=9913; const counts={}; const results=[];
for(let n=0;n<36;n++) {
 results.push(await driveGame({seed:210000120+n,start:n%6},input=>{
  const {game,playerId,request}=input,key=playerId+':'+request.type;
  if((counts[key]??0)<4 && game.deck.length>=4) {
   const before=encodeDecision(input), history={...game.publicHistory,actions:[...game.publicHistory.actions],events:[...game.publicHistory.events]};
   const hands=game.players.map(p=>[...p.hand]), deck=[...game.deck], presentation=[...game.presentationEvents],log=[...game.log];
   for(const p of game.players.filter(p=>p.id!==playerId))for(const card of [...p.hand]) {
    const replacement=game.deck[0];
    game.moveCard(card.id,{zone:'deck'},{animate:false});
    game.moveCard(replacement.id,{zone:'hand',playerId:p.id},{animate:false});
   }
   game.deck.reverse(); Object.assign(game.publicHistory,history);game.log.push('HIDDEN_AUDIT_SENTINEL');
   const changed={...input,request:{...request,privateDeck:game.deck,title:'HIDDEN_AUDIT_SENTINEL'},candidates:request.type==='action'?actionCandidates(game,playerId):input.candidates};
   assert.deepEqual(encodeDecision(changed),before, key);
   for(const p of game.players.filter(p=>p.id!==playerId)) {
    for(const card of [...p.hand])game.moveCard(card.id,{zone:'deck'},{animate:false});
    for(const card of hands[p.id])game.moveCard(card.id,{zone:'hand',playerId:p.id},{animate:false});
   }
   const order=new Map(deck.map((card,i)=>[card.id,i]));game.deck.sort((a,b)=>order.get(a.id)-order.get(b.id));
   Object.assign(game.publicHistory,history);game.presentationEvents=presentation;game.log=log;game.assertCardLocations();
   counts[key]=(counts[key]??0)+1;
  }
  state=(Math.imul(state,1664525)+1013904223)>>>0;return Math.floor(state/2**32*input.candidates.length);
 }));
}
console.log(JSON.stringify({games:results.length,truncated:results.filter(r=>r.truncated).length,comparisons:Object.values(counts).reduce((a,b)=>a+b,0),counts},null,2));
