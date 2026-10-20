import {Game} from '/workspace/xingbei/xingbei-cli/src/engine.js';
import {captureObservation,observationView} from '/workspace/xingbei/xingbei-cli/src/ai/observation.js';
import {stateOf} from '/workspace/xingbei/xingbei-cli/src/ai/v1.5-candidate/model.js';
import {actionPlan,explain} from '/workspace/xingbei/xingbei-cli/src/ai/v1.5-candidate/planner.js';
const g=new Game({heroIds:['guardianAngel',...Array(5).fill('none')]});const c=g.deck.find(c=>c.name==='holyShield');g.moveCard(c.id,{zone:'hand',playerId:0});g.startTurn(0);
const s=stateOf(observationView(captureObservation(g,0)),0),p=actionPlan(s,0,{type:'play',index:0,targetId:3});
await g.executeAction(0,{type:'play',index:0,targetId:3},{choose:r=>r.type==='playerChoice'?4:false});
console.log(JSON.stringify({predictedHealing:explain(s,p).parts.healing,predictedPlayers:p.branches[0].state.players.map(p=>p.healing),actualPlayers:g.players.map(p=>p.healing),shieldTarget:3,actualHealingTarget:4}));
