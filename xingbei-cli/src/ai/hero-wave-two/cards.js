import { cardScore as basicScore } from "../evaluation.js";
export const heroIds = new Set([
  "saint",
  "holyLancer",
  "plagueMage",
  "elementalist",
  "magicalGirl",
  "valkyrie",
]);
const unique = {
  saint: ["healingArt", "healingLight"],
  elementalist: ["meteor", "freeze", "fireball", "windBlade", "lightning"],
};
export const elements = (g, id, c) =>
  c.getTraits({ game: g, playerId: id }).elements;
export function retentionBonus(g, id, c, retained = []) {
  const hero = g.player(id).hero.id,
    es = elements(g, id, c);
  const same = retained.some((other) =>
    elements(g, id, other).some((e) => es.includes(e)),
  );
  if ((unique[hero] ?? []).some((skill) => c.hasUniqueSkill(skill))) return 5;
  if (hero === "saint" && es.includes("water")) return same ? 1 : 3;
  if (hero === "holyLancer" && (es.includes("water") || c.type === "spell"))
    return same ? 1.5 : 3;
  if (hero === "plagueMage" && (es.includes("earth") || c.type === "spell"))
    return same ? 1.5 : 3;
  if (hero === "magicalGirl" && c.type === "spell") return 3;
  if (hero === "valkyrie" && c.type === "spell")
    return g.player(id).hero.state?.form ? 3 : 1.5;
  return 0;
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
