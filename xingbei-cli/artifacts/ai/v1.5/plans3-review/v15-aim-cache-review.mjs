import fs from 'node:fs';import assert from 'node:assert/strict';
const path='/workspace/xingbei/xingbei-cli/src/ai/v1.5-candidate/horizon.js';
const current=fs.readFileSync(path,'utf8').replace("'../../cards.js'","'file:///workspace/xingbei/xingbei-cli/src/cards.js'");
const old=current.replace('recentTargets(s.actions,actor.id)',"(s.actions??[]).filter(e=>e.type==='attack'&&e.actorId===actor.id).slice(-6)");
const load=source=>import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const {terminalForecast:cached}=await load(current),{terminalForecast:scan}=await load(old);
let comparisons=0;const teams=['red','blue','blue','red','red','blue'];
for(let history=0;history<40;history++){
 const actions=Object.freeze(Array.from({length:history*7},(_,i)=>Object.freeze({type:i%4===0?'response':'attack',actorId:(i*7+history)%6,targetId:(i*5+1)%6})));
 for(let n=0;n<18;n++){
 const s={actions,beliefs:{},observer:n%6,current:(n*5)%6,teams:{red:{morale:1+n%6,cups:2},blue:{morale:1+(n+2)%6,cups:3}},players:teams.map((team,id)=>({id,team,hero:['berserker','priest','none'][id%3],count:(id+n)%7,limit:6,healing:(id+n)%3,energy:{gem:n%2},effects:(id+n)%5===0?[{name:'holyShield'}]:[],hand:id===n%6?[{type:'attack',name:'fireStrike'}]:[]}))};
 assert.equal(cached(s),scan(s));comparisons++;
 // Repeating a retained actions identity must stay equal after actor-state changes.
 s.beliefs={};s.current=(s.current+1)%6;s.players[0].count=(n+3)%7;
 assert.equal(cached(s),scan(s));comparisons++;
 }
}
console.log(JSON.stringify({comparisons,failures:0}));
