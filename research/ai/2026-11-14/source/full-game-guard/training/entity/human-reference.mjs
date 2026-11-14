// Offline observation reconstruction only. Never resume a generator or use
// snapshot hidden cards as model features. Current encoder enforces visibility.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Game} from '../../src/engine.js';
import {resolveDecision} from '../decision-runner.mjs';
import {decisionPlayer} from '../candidates.mjs';
import {createEntityEncoder} from './observation.mjs';
const root=process.argv[2], output=process.argv[3];
const rows=[],reports=[];
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
function restore(config,s) {
 const g=new Game({...config,ruleVariant:'standard'});
 for(const p of s.players){assert.equal(g.player(p.id).hero.id,p.hero.id);Object.assign(g.player(p.id).hero.state,structuredClone(p.hero.state));g.player(p.id).healing=p.healing;g.player(p.id).energy={...p.energy};g.player(p.id).pendingOverflow=p.pendingOverflow;}
 assert.equal(g.cards.size,s.cards.length);
 for(const c of [...g.cards.values()])g.moveCard(c.id,{zone:'outside'});
 for(const c of s.cards){assert.ok(g.cards.has(c.id));const card=g.cards.get(c.id);card.attachment=structuredClone(c.attachment);g.moveCard(c.id,c.location,{animate:false});card.coveredVisibility=c.coveredVisibility;card.discardVisibility=c.discardVisibility;}
 // Restore order within registered zones, without changing their membership.
 const order=(zone,ids)=>{assert.deepEqual([...zone.map(c=>c.id)].sort(),[...ids].sort());const rank=new Map(ids.map((id,i)=>[id,i]));zone.sort((a,b)=>rank.get(a.id)-rank.get(b.id));};
 for(const p of s.players){const current=g.player(p.id);order(current.hand,p.hand.map(c=>c.id));order(current.covered,p.covered.map(c=>c.id));assert.equal(current.handLimit,p.handLimit);}
 for(const zone of ['deck','discard','field','outside'])order(g[zone],s[zone]);
 g.current=s.current;g.winner=s.winner;g.teams=structuredClone(s.teams);g.turn.state=structuredClone(s.turn);g.turn.extraTurns=structuredClone(s.extraTurns??[]);g.turn.followupTurns=structuredClone(s.followupTurns??[]);g.turn.resumePlayerId=s.resumePlayerId;
 Object.assign(g.publicHistory,structuredClone(s.publicHistory));g.pendingRuleEvents=[];g.assertCardLocations();return g;
}
function revive(v,g){
 if(!v||typeof v!=='object')return v;
 if(typeof v.id==='string'&&g.cards.has(v.id))return g.cards.get(v.id);
 if(Number.isInteger(v.id)&&v.hero&&v.hand)return g.player(v.id);
 return Array.isArray(v)?v.map(x=>revive(x,g)):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,revive(x,g)]));
}
for(const name of fs.readdirSync(root).sort()){
 const folder=path.join(root,name),metaPath=path.join(folder,'metadata.json');if(!fs.existsSync(metaPath))continue;
 const m=JSON.parse(fs.readFileSync(metaPath)),config=m.configuration.initialConfig,seat=m.configuration.humanSeat;
 if(m.configuration.mode!=='normal'||config.heroIds[seat]!=='sage')continue;
 const events=fs.readdirSync(folder).filter(n=>/^\d+\.json$/.test(n)).sort().map(n=>JSON.parse(fs.readFileSync(path.join(folder,n))));
 const choices=new Map(events.filter(r=>r.event.type==='decision-choice').map(r=>[r.event.decisionId,r.event.choice]));
 const result={gameId:name,seed:config.seed,sourceRevision:m.ruleRevision,accepted:0,rejected:[],damageLogs:events.flatMap(r=>(r.event.log??[]).filter(x=>/贤者.*(法典|反弹)|法术伤害/.test(x)).map(text=>({sequence:r.sequence,text})))};
 for(const record of events){
  const e=record.event;let request,choice;
  if(e.type==='command'&&(e.depth??0)===0&&e.args[0]===seat){
   if(['attackWithDecisions','playWithDecisions','playMagicWithDecisions'].includes(e.name))choice={type:'play',index:e.args[1],targetId:e.args[2]};
   else if(e.name==='executeAction')choice=e.args[1];
   else continue;
   request={type:'action'};
  }else if(e.type==='decision-request'&&e.parentDecisionId==null&&decisionPlayer(e.request)===seat){request=e.request;choice=choices.get(e.decisionId);if(request.type==='overflow')continue;}
  else continue;
  try{
   const game=restore(config,e.state);request=revive(request,game);const encoder=createEntityEncoder(),pending=[];
   const select=input=>{
    const index=input.teacherIndex?input.teacherIndex(choice):input.candidates.findIndex(c=>canonical(c)===canonical(choice));
    if(index<0)throw new Error('Human command is not represented by current candidates');
    if(input.candidates.length>1){const observation=encoder(input);
     // Hidden-zone permutation must not change the encoded demonstration.
     for(const p of game.players)if(p.id!==seat)p.hand.reverse();game.deck.reverse();
     assert.deepEqual(createEntityEncoder()(input),observation);
     for(const p of game.players)if(p.id!==seat)p.hand.reverse();game.deck.reverse();
     pending.push({gameId:name,sourceSeed:config.seed,sequence:record.sequence,hero:'sage',skillId:request.skillId??choice?.skillId??null,stage:input.request.stage??request.type,choice:index,observation,weight:.1});
    }
    return index;
   };
   let resolved=await resolveDecision(game,seat,request,select);
   if(request.type==='action'&&resolved.type==='activate'&&choice.type!=='activate'){
    // The UI recorded the complete ordinary action after explicitly declining
    // activation. Training represents its intent and execution separately.
    assert.equal(game.turn.state.activationDeclined,true);
    const bridge=game.turn.activate(seat,{},true).next();
    assert.equal(bridge.done,true,'Declined activation must have no effects or decisions');
    resolved=await resolveDecision(game,seat,request,select);
   }
   const normalized=v=>request.type==='cardChoice'&&Array.isArray(v)?[...v].sort((a,b)=>a-b)
    :v&&typeof v==='object'&&!Array.isArray(v)&&v.cardIds?{...v,cardIds:[...v.cardIds].sort()}:v;
   assert.equal(canonical(normalized(resolved)),canonical(normalized(choice)),'Reconstructed command differs from human command');rows.push(...pending);result.accepted+=pending.length;
  }catch(error){result.rejected.push({sequence:record.sequence,type:request.type,message:error.message});}
 }
 reports.push(result);
}
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
fs.writeFileSync(output+'.report.json',JSON.stringify({purpose:'Fallible low-weight human reference, not reward or expert truth',snapshotUse:'Encode isolated decisions only; replay only the effect-free declined-activation bridge, never resume a game',rows:rows.length,games:reports},null,2));
console.log(JSON.stringify({rows:rows.length,games:reports.map(({gameId,accepted,rejected})=>({gameId,accepted,rejected}))}));
