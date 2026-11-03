import { createHash } from 'node:crypto';
export function boundaryState(game) {
  return { current:game.current, winner:game.winner, teams:game.teams,
    players:game.players.map(p=>p.toJSON()), cards:[...game.cards.values()].map(c=>c.toJSON()),
    deck:game.deck.map(c=>c.id), discard:game.discard.map(c=>c.id), field:game.field.map(c=>c.id),
    turn:{state:game.turn.state, extraTurns:game.turn.extraTurns, followupTurns:game.turn.followupTurns,
      resumePlayerId:game.turn.resumePlayerId, lastEndedPlayerId:game.turn.lastEndedPlayerId},
    publicHistory:game.publicHistory };
}
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function phaseClass(game) {
  const {red,blue}=game.teams;
  if ((red.morale<=5 && blue.morale<=5) || Math.min(red.morale,blue.morale)<=3 || Math.max(red.cups,blue.cups)>=4) return 'ending';
  if (Math.min(red.morale,blue.morale)<=8 || Math.max(red.cups,blue.cups)>=2) return 'middle';
  return null;
}
