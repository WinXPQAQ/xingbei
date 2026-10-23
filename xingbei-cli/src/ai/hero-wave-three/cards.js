import { cardScore as basicScore } from "../evaluation.js";
export const heroIds = new Set(["assassin", "magicSwordsman", "adjudicator", "sage", "prayer", "heroicPuppet"]);
export const elements = (game, id, card) => card.getTraits({ game, playerId: id }).elements;
export function cardScore(game, id, card, retained = []) {
  const base = basicScore(game, id, card, retained);
  if (card.name === "holyLight" || card.name === "darkStrike") return base;
  const player = game.player(id), hero = player.hero.id, es = elements(game, id, card);
  const same = retained.some((other) => elements(game, id, other).some((e) => es.includes(e)));
  let extra = 0;
  if (hero === "assassin" && es.includes("water")) extra = same ? 8 : 24;
  if (hero === "magicSwordsman") {
    if (card.type === "attack" && es.includes("fire")) extra = same ? 16 : 30;
    if (card.type === "spell") extra = retained.filter((c) => c.type === "spell").length < 2 ? 15 : -12;
  }
  if (hero === "sage") extra = same ? 3 : 16;
  if (hero === "prayer") {
    if (["powerBlessing", "speedBlessing"].some((skill) => card.hasUniqueSkill(skill))) extra = same ? 25 : 43;
    else if (card.type === "attack" && (player.hero.state?.prayerRunes ?? 0) < 3) extra = same ? 4 : 12;
  }
  if (hero === "heroicPuppet") {
    const battle = player.hero.state?.battleRunes ?? 0;
    extra = same ? (battle > 0 ? 22 : 0) : 12;
  }
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
  return !["magicSwordsman", "sage"].includes(game.player(id).hero.id) || action.stones.crystal === 0;
}
