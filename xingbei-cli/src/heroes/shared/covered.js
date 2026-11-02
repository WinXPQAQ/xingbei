// Common entity operations; heroes decide when and why to use them.
export const coveredCards = (player, pile) => player.covered.filter(c => c.location.pile === pile);
export const seatOrder = (game, actorId, ids = game.players.map(p => p.id)) =>
  [...ids].sort((a, b) => (a - actorId + game.players.length) % game.players.length - (b - actorId + game.players.length) % game.players.length);
export function* discardHand(game, playerId, count, skillId, options, visibility = 'hidden') {
  const n = Math.min(count, game.player(playerId).hand.length);
  if (!n) return [];
  const cards = yield* game.chooseHandCards(playerId, n, () => true, { skillId, title: `选择${n}张弃牌` });
  game.discardCards(playerId, cards, { reason: skillId, visibility });
  yield* game.flushRuleEvents(options);
  return cards;
}
export function* trimCovered(game, player, pile, limit, skillId) {
  while (coveredCards(player, pile).length > limit) {
    const card = yield* game.chooseCoveredCard(player.id, pile, { skillId, title: '盖牌超过上限，选择移除' });
    game.discardCovered(player.id, card, { skillId });
  }
}
