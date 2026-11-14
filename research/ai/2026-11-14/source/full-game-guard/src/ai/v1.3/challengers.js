// Independent deterministic scoring styles, not economy weights/utility/search.
// Legal enumeration and mandatory rule helpers are shared; these are stress
// opponents, not independent human-strength evidence.
import * as baseline from '../v1.0/index.js';
import {isolatePolicy} from '../observation.js';
import {enumerate} from './index.js';
export function createChallenger(style) {
 return isolatePolicy({...baseline,
  rankAiActions(g,id) {
   const actor=g.player(id);return enumerate(g,id).map(action=>{
    const target=g.player(action.targetId??action.targetIds?.[0]??id),c=action.type==='play'?actor.hand[action.index]:null;
    let score=0;
    if(action.type==='refresh')score=1000;
    if(action.type==='synthesize')score=500;
    if(action.type==='purchase')score=actor.hand.length<3?70:20;
    if(action.type==='refine')score=actor.energy.gem+actor.energy.crystal===0&&actor.hand.length<=4?25:1;
    if(c){score=25+(c.type==='attack'?target.hand.length*5:8)-(c.name==='darkStrike'?18:0);if(style==='reserve'&&actor.hand.length<=3)score-=35;}
    if(action.type==='skill') {
     score=12+action.cardIds.length*10;
     if(action.skillId.endsWith('Seal'))score+=30+target.hand.length*6;
     if(action.skillId==='waterPower')score=target.team===actor.team?45-target.hand.length*8:-100;
     if(action.skillId==='flashTrap')score=target.team!==actor.team?target.hand.length*9:-100;
     if(action.skillId==='sacredDomain')score=action.mode==='damage'?(target.team!==actor.team?target.hand.length*10:-100):15;
    }
    if(style==='flow'&&actor.hand.length>=4)score+=(c?20:0)+(action.cardIds?.length??0)*12;
    if(style==='reserve'&&c?.name==='holyLight')score-=25;
    return {action,score,reason:`independent-${style}`};
   }).sort((a,b)=>b.score-a.score);
  },
  chooseAiResponse(g,r){if(style==='reserve'&&r.target.hand.length+(r.actor?.hero.id==='berserker'?4:2)-r.target.healing<=r.target.handLimit)return null;return baseline.chooseAiResponse(g,r);},
  chooseAiRuleDecision(r,g){if(style==='flow'&&r.skillId==='piercingShot'&&g.player(r.playerId).hand.length>=5)return baseline.chooseAiDiscard(g,r.playerId,1,r.valid);return baseline.chooseAiRuleDecision(r,g);},
 });
}
