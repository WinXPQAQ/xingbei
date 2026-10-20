import {Game} from '/workspace/xingbei/xingbei-cli/src/engine.js';
import {captureObservation,observationView} from '/workspace/xingbei/xingbei-cli/src/ai/observation.js';
import {stateOf,components} from '/workspace/xingbei/xingbei-cli/src/ai/v1.5-candidate/model.js';
import {attackBranches} from '/workspace/xingbei/xingbei-cli/src/ai/v1.5-candidate/planner.js';
const take=(g,id,pred)=>{const c=g.deck.find(pred);if(!c)throw Error('card');g.moveCard(c.id,{zone:'hand',playerId:id});return c;};
let checked=0,terminals=0;const failures=[];
for(const hero of ['windSwordmaster','marksman','berserker'])for(const count of [0,3,4,5,6])for(const healing of [0,1,2])for(const shielded of [false,true]){
 if(hero==='berserker'&&healing!==2)continue;
 const g=new Game({heroIds:[hero,...Array(5).fill('none')]});take(g,0,c=>c.type==='attack'&&(hero==='marksman'?c.uniqueSkills.includes('precisionShot'):hero==='berserker'?c.uniqueSkills.includes('bloodyRoar'):true));
 for(let i=0;i<count;i++)take(g,1,c=>c.type==='attack');g.player(1).healing=healing;g.teams.blue.morale=1;
 if(shielded){const c=take(g,3,c=>c.name==='holyShield');g.attachCard(c.id,1,{effectId:'holyShield',sourcePlayerId:3});}
 g.startTurn(0);if(hero==='windSwordmaster')g.turn.state.attackCount=2;
 const s=stateOf(observationView(captureObservation(g,0)),0),bs=attackBranches(s,0,s.players[0].hand[0],1,{count:hero==='windSwordmaster'?2:0,precision:hero==='marksman'}),b=bs[0];
 const predicted=components(b.state).terminal;
 await g.executeAction(0,{type:'play',index:0,targetId:1},{choose:r=>r.type==='healing'?Math.min(healing,r.context.amount,Math.max(0,count+r.context.amount-6)):r.type==='numberChoice'?0:['precisionShot','bloodyRoar'].includes(r.skillId),chooseResponse:()=>null,chooseHealing:r=>Math.min(healing,Math.max(0,count+r.context.amount-6))});
 checked++;if(predicted>=100000){terminals++;if(g.winner!=='red')failures.push({hero,count,healing,shielded,predicted,winner:g.winner,morale:g.teams.blue.morale});}
}
console.log(JSON.stringify({checked,terminals,failures}));
