import { cardScore as basicScore } from "../base/evaluation.js";
import { heroIds, heroAi } from "./registry.js";
export { heroIds };
export const elements = (game, id, card) => card.getTraits({ game, playerId: id }).elements;
export function cardScore(game, id, card, retained = []) {
  const base = basicScore(game, id, card, retained);
  if (card.name === "holyLight" || card.name === "darkStrike") return base;
  const player = game.player(id), es = elements(game, id, card);
  const same = retained.some((other) => elements(game, id, other).some((e) => es.includes(e)));
  const extra = heroAi(player.hero.id).cardBonus?.({ player, card, retained, elements: es, same }) ?? 0;
  return Math.min(130, base + extra);
}
export function keepCards(game, id, cards, count) {
  const left = [...cards], kept = [];
  while (kept.length < count && left.length) {
    left.sort((a, b) => cardScore(game, id, b, kept) - cardScore(game, id, a, kept));
    kept.push(left.shift());
  }
  return kept;
}
export function chooseAiDiscard(game, id, count, valid = null) {
  const hand = game.player(id).hand, indexes = valid ?? hand.map((_, i) => i);
  const reserved = new Set(game.turn.state?.reservedCardIds ?? []);
  const unreserved = indexes.filter((i) => !reserved.has(hand[i].id));
  const eligible = unreserved.length >= count ? unreserved : indexes;
  const kept = new Set(keepCards(game, id, eligible.map((i) => hand[i]), Math.max(0, eligible.length - count)).map((c) => c.id));
  return eligible.filter((i) => !kept.has(hand[i].id));
}
export function cardCost(game, id, cards) {
  return cards.reduce((sum, card) => sum + cardScore(game, id, card,
    game.player(id).hand.filter((c) => c.id !== card.id)) / 35, 0);
}
export function acceptsAction(game, id, action) {
  if (action.type !== "refine") return true;
  if (action.stones.gem + action.stones.crystal !== 2) return false;
  return heroAi(game.player(id).hero.id).acceptsRefine?.(action) ?? true;
}
