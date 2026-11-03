import { combinations } from './card-sets.js';

export function actionRequired(game, playerId) {
  const s=game.turn.state;
  return !!s && s.playerId===playerId && s.activationDone && !s.completed && !s.skipped && !s.actionType && !game.winner;
}
// A read-only projection: no zone movement, trigger, payment or random draw.
export function canContinueWithHand(game, playerId, hand) {
  const view=Object.create(game), player=Object.create(game.player(playerId));
  player.hand=hand;
  view.players=game.players.map(p=>p.id===playerId?player:p);
  view.turn=Object.create(game.turn);view.turn.game=view;
  return view.legalCards(playerId).length>0 || view.legalSkillActions(playerId).length>0;
}
export function safeRemovalSets(game, playerId, count, valid) {
  const p=game.player(playerId), sets=combinations(valid??p.hand.map((_,i)=>i),count);
  if (!actionRequired(game,playerId))return sets;
  return sets.filter(set=>canContinueWithHand(game,playerId,p.hand.filter((_,i)=>!set.includes(i))));
}
// Foreign hidden faces are never inspected to prohibit an opponent's choice.
// Only a publicly certain loss of the whole hand is inferred here.
export function knownRemovalBlocked(game, actorId, targetId, count) {
  if (!actionRequired(game,targetId))return false;
  const player=game.player(targetId);
  if(actorId!==targetId && count<player.hand.length)return false;
  if(actorId===targetId)return safeRemovalSets(game,targetId,Math.min(count,player.hand.length)).length===0;
  return !canContinueWithHand(game,targetId,[]);
}
