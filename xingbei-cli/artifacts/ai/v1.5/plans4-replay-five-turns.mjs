import fs from 'node:fs';import assert from 'node:assert/strict';import {Game} from '../../../src/engine.js';import {getPolicy} from '../../../src/ai/versions.js';import {captureObservation} from '../../../src/ai/observation.js';
const cases=JSON.parse(fs.readFileSync('artifacts/ai/targeted-fixes-1/negative-cases.json')).cases,results=[];
for(const old of cases){
 const g=new Game({seed:old.config.seed,heroIds:old.config.heroIds}).setup();g.current=old.config.start;
 const events=[],record=g.recordPublicAction;g.recordPublicAction=function(e){record.call(this,e);events.push(structuredClone(e));};let candidateTurn=false;
 const policy=id=>getPolicy(candidateTurn&&id===old.actorId?'experimental/plans-4':g.player(id).team===old.config.team?'v1.4':'v1.3');
 const discard=(id,n)=>policy(id).chooseAiDiscard(g,id,n);
 const options={choose:r=>decide(r),chooseResponse:r=>policy(r.target.id).chooseAiResponse(g,r),overflow:(p,n)=>discard(p.id,n),resolveOverflow:r=>g.resolveOverflowWithDecisions(r.player.id,discard(r.player.id,r.player.hand.length-r.player.handLimit),options)};
 function decide(r){if(r.type==='response')return options.chooseResponse(r);if(r.type==='overflow')return options.resolveOverflow(r);return policy(r.playerId??r.player.id).chooseAiRuleDecision(r,g);}
 g.automaticDecision=decide;
 for(let turn=1;turn<=old.turn;turn++){
  const id=g.current;const phase=await g.beginTurn(id,{choose:options.choose,chooseWeakness:options.choose,resolveOverflow:options.resolveOverflow},options);assert(!g.winner);
  if(!phase.skipped){if(turn===old.turn){assert.equal(id,old.actorId);const before=captureObservation(g,id,{actions:true});const {actions,...legacy}=before.publicHistory;assert.deepEqual({...before,publicHistory:legacy},old.observation);candidateTurn=true;results.push({hero:old.hero,config:old.config,turn,before,actions:[],eventStart:events.length});}
   while(g.turn.needsAction()){
    const action=policy(id).chooseAiAction(g,id);if(candidateTurn)results.at(-1).actions.push(action);
    if(action.type==='pass'){g.skipExtraActions(id);break;}await g.executeAction(id,action,options);g.assertCardLocations();if(g.winner)break;
   }
  }
  await g.endTurnWithDecisions(options);g.assertCardLocations();
 }
 const r=results.at(-1);r.events=events.slice(r.eventStart);delete r.eventStart;r.after=captureObservation(g,old.actorId);r.winner=g.winner;
}
fs.writeFileSync('artifacts/ai/v1.5/plans4-five-real-engine-turns.json',JSON.stringify({source:process.argv[2]??'plans-4-pre-freeze',scope:'Original engine replay reaches exact old observation, then candidate controls the selected actor for one complete real turn; other seats retain old policies. Full public event chain only; not a claim of optimality or subsequent match strength.',results},null,2));console.log(results.map(r=>({hero:r.hero,actions:r.actions,events:r.events.length,winner:r.winner})));
