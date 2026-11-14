import { aiHeroId, predictedMoraleLoss } from '../v1.0/evaluation.js';

// Current attack facts are public; this is not a simulation of hidden hands.
export function incomingDamage(game, request) {
  if (!request.attack) return request.damage ?? 2;
  const actor = request.actor, target = request.target, hero = aiHeroId(actor);
  let amount = 2;
  if (hero === 'berserker') {
    amount += 1 + Number(actor.hand.length > 3); // the attacking card has already left hand
    if (!request.isCounter && request.attack.hasUniqueSkill('bloodBlade')) amount += target.hand.length === 2 ? 2 : target.hand.length === 3 ? 1 : 0;
    if (game.canPayEnergy(actor.id, 'gem') && predictedMoraleLoss(target, amount+2)>predictedMoraleLoss(target, amount)) amount += 2;
  }
  return amount;
}

export function futurePressure(game, playerId, heroThreats = false) {
  const target = game.player(playerId);
  let pressure = target.getStatus('poison').length;
  const current = game.turn.state?.playerId ?? game.current;
  // Include the current enemy only when it may still have a continuation.
  const active = game.player(current);
  if (active.team !== target.team && (game.turn.hasExtraActions() || aiHeroId(active)==='windSwordmaster')) pressure += heroThreats ? 1.5 : 0.5;
  for(let step=1;step<6;step++) {
    const enemy=game.player((current+step)%6);
    if(enemy.id===playerId)break;
    if(enemy.team===target.team)continue;
    let value=0.45;
    if(heroThreats) {
      const hero=aiHeroId(enemy), hand=enemy.hand.length, energy=enemy.energy.gem+enemy.energy.crystal;
      if(hero==='priest' && hand>=2 && energy && enemy.healing) value=1.4;
      if(hero==='marksman' && hand>=1) value=1.2 + Number(energy>0)*0.5;
      if(hero==='windSwordmaster' && hand>=2) value=1.1 + Number(hand>=3 && energy>0)*0.8;
      if(hero==='berserker' && hand>=1) value=1 + Number(enemy.energy.gem>0)*0.6;
      if(hero==='sealer' && hand>=2) value=0.9;
      if(hero==='guardianAngel') value=0.3;
    }
    pressure+=value;
  }
  return pressure;
}

export function heroAdjustment(game, actorId, card, targetId) {
  const actor=game.player(actorId), target=game.player(targetId), hero=aiHeroId(actor);
  // Modest, separately switchable recognition of unavoidable spell/third-hit threats.
  if(hero==='marksman' && actor.hand.some(c=>c.type==='spell')) {
    const afterResponse={...target, hand:{length:Math.max(0,target.hand.length-1)}};
    return predictedMoraleLoss(afterResponse,2)*8;
  }
  if(hero==='windSwordmaster' && game.turn.state?.attackCount===2) return predictedMoraleLoss(target,2)*8;
  return 0;
}
