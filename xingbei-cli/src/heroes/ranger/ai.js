import {
  cheapCards,
  cheapCovered,
  damageTarget,
} from "../shared/ai/decisions.js";
export const rangerAi = {
  id: "ranger",
  cardBonus: ({ card, elements, same }) =>
    card.type === "attack"
      ? (elements.includes("wind") ? 16 : 8) + (same ? 5 : 0)
      : 0,
  resourceValue: (p) => p.coveredCount * 3,
  attackHitBonus: ({ player }) => (player.coveredCount ? 5 : 0),
  followAttackScore: ({ state, id }, api) =>
    state.players[id].hand.filter((c) => c.type === "attack").length > 1
      ? 4
      : 0,
  decisions: {
    bulletShot: cheapCovered,
    bulletElement: ({ source }) =>
      source.hand.some((c) => c.type === "attack") ? "wind" : "thunder",
    earthBullet: damageTarget,
    doubleShadow: ({ source, context }) =>
      source.hand.some(
        (c) => c.type === "attack" && c.elements.includes(context.element),
      ),
    elfSwordDance: ({ source, context }) =>
      !context.attackTraits?.elements?.includes("wind") &&
      source.hand.some(
        (c) => c.type === "attack" && c.elements.includes("wind"),
      ),
    bulletEnchant: cheapCards,
    bulletEnergy: ({ request }) =>
      request.choices.find((c) => c.value === "crystal")?.value ??
      request.defaultValue,
  },
};
