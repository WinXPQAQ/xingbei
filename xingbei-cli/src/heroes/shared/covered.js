import { actionRequired, safeRemovalSets } from '../../inability.js';
import { RuleError } from '../../errors.js';
// Common entity operations; heroes decide when and why to use them.
export const coveredCards = (player, pile) => player.covered.filter(c => c.location.pile === pile);
export const seatOrder = (game, actorId, ids = game.players.map(p => p.id)) =>
  [...ids].sort((a, b) => (a - actorId + game.players.length) % game.players.length - (b - actorId + game.players.length) % game.players.length);
export function* discardHand(game, playerId, count, skillId, options, visibility = 'hidden') {
  const n = Math.min(count, game.player(playerId).hand.length);
  if (!n) return [];
  const actorId=options?.inabilitySourceId ?? game.activeTrigger?.ownerId ?? playerId;
  if (options?.preserveAction && actionRequired(game,playerId) && game.knownRemovalBlocked(actorId,playerId,n)) throw new RuleError('此操作将使角色无法行动');
  const before={actorId,targetId:playerId,skillId,count:n,handCount:game.player(playerId).hand.length};
  const cards = yield* game.chooseHandCards(playerId, n, () => true, { skillId, title: `选择${n}张弃牌`, preserveAction:options?.preserveAction, preserveUsable:options?.preserveUsable });
  const maliciousChoice=options?.preserveAction && actionRequired(game,playerId) && safeRemovalSets(game,playerId,n).length>0 && !safeRemovalSets(game,playerId,n).some(set=>set.every(i=>cards.includes(game.player(playerId).hand[i])));
  game.discardCards(playerId, cards, { reason: skillId, visibility });
  if(maliciousChoice)game.forfeitMaliciousInability(playerId,skillId,playerId,{...before,selected:cards.map(c=>c.id)});
  yield* game.flushRuleEvents(options);
  return cards;
}
export function* trimCovered(game, player, pile, limit, skillId) {
  while (coveredCards(player, pile).length > limit) {
    const card = yield* game.chooseCoveredCard(player.id, pile, { skillId, title: '盖牌超过上限，选择移除' });
    game.discardCovered(player.id, card, { skillId });
  }
}
