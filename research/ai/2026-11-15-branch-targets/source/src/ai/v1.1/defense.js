import * as baseline from '../v1.0/index.js';
import { cardScore, predictedMoraleLoss } from '../v1.0/evaluation.js';
import { incomingDamage, futurePressure } from './threats.js';
import { hitEstimate } from './reading.js';

export function rankResponses(game, request, { heroThreats = false } = {}) {
  const target=request.target, amount=incomingDamage(game,request);
  if(!request.valid.length)return [{value:null,cost:0,reason:'no-response'}];
  if(request.shieldable!==false && target.getStatus('holyShield').length) return [{value:baseline.chooseAiResponse(game,request),cost:0,reason:'shield-baseline'}];
  const loss=predictedMoraleLoss(target,amount), room=Math.max(0,target.handLimit-target.hand.length);
  const future=futurePressure(game,target.id,heroThreats);
  const futureLoss=Math.max(0,Math.min(amount,room)+future-room);
  const stones=request.attack && game.stoneCounts(request.actor.team).total<5 ? 4 : 0;
  const lethal=loss>=game.teams[target.team].morale ? 1000 : 0;
  const choices=[{value:null,cost:loss*20+futureLoss*5+stones-Math.min(room,amount)*1.8+lethal,reason:'accept-public-risk'}];
  for(const entry of request.valid) {
    let cost=cardScore(game,target.id,entry.card,target.hand.filter(c=>c!==entry.card))*0.065-2;
    const traits=entry.card.getTraits({game,playerId:target.id});
    // A response that exposes a sealed element itself triggers three spell damage.
    for(const element of traits.elements)if(target.getStatus(`${element}Seal`).length)cost+=predictedMoraleLoss({...target,hand:{length:target.hand.length-1}},3)*20+5;
    if(request.attack && request.actor.hero.id==='marksman' && !request.isCounter && request.actor.hand.length>0) {
      // Unknown spell possession: a bounded risk, not access to the shooter's hand.
      cost+=predictedMoraleLoss({...target,hand:{length:target.hand.length-1}},2)*7;
    }
    if(entry.card.type==='attack') {
      for(const opponent of request.counterTargets) {
        const p=hitEstimate(game,target.id,entry.card,opponent.id,{counter:true,history:false});
        const benefit=p*(4+predictedMoraleLoss(opponent,2)*8);
        choices.push({value:{index:entry.index,targetId:opponent.id},cost:cost-benefit,reason:'counter'});
      }
    } else choices.push({value:{index:entry.index,targetId:request.nextTarget?.id??null},cost:cost-(entry.card.name==='magicBullet'?5:0),reason:'spell-response'});
  }
  return choices.sort((a,b)=>a.cost-b.cost);
}
export const chooseDefense = (game,request,options) => rankResponses(game,request,options)[0].value;
