import { cardScore as basicScore } from "../base/evaluation.js";
import { heroPolicy } from "./registry.js";
export { heroIds } from "./registry.js";
export const elements = (g, id, card) => card.getTraits({ game: g, playerId: id }).elements;
export function retentionBonus(g, id, card, retained = []) {
  const es = elements(g, id, card);
  const same = retained.some((other) => elements(g, id, other).some((element) => es.includes(element)));
  return heroPolicy(g, id)?.retentionBonus?.(g, id, card, { elements: es, same, retained }) ?? 0;
}
export function cardScore(g, id, c, retained = []) {
  // Preserve universal dark/first-light protection. Bonuses apply to the owner,
  // not to every printed unique label on a card.
  const base = basicScore(g, id, c, retained);
  if (c.name === "darkStrike" || c.name === "holyLight") return base;
  return Math.min(130, base + retentionBonus(g, id, c, retained) * 10);
}
export function keepCards(g, id, cards, count) {
  const remaining = [...cards],
    kept = [];
  while (kept.length < count && remaining.length) {
    remaining.sort(
      (a, b) => cardScore(g, id, b, kept) - cardScore(g, id, a, kept),
    );
    kept.push(remaining.shift());
  }
  return kept;
}
export function chooseAiDiscard(g, id, count, valid = null) {
  const hand = g.player(id).hand,
    allowed = valid ?? hand.map((_, i) => i);
  const protectedIds = new Set(
    keepCards(
      g,
      id,
      allowed.map((i) => hand[i]),
      allowed.length - count,
    ).map((c) => c.id),
  );
  return allowed.filter((i) => !protectedIds.has(hand[i].id));
}
