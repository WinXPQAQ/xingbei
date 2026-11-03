import {
  cheapCards,
  damageTarget,
  usefulExtra,
} from "../shared/ai/decisions.js";
export const enviousGirlAi = {
  id: "enviousGirl",
  cardBonus: ({ card, elements }) =>
    card.type === "attack"
      ? 10
      : elements.some((e) => ["earth", "wind"].includes(e))
        ? 5
        : 0,
  attackHitBonus: () => 4,
  attackMissBonus: () => 5,
  scoreSkill({ next, targetId, skillId }, api) {
    if (skillId === "lovesickness") {
      api.hurt(next, targetId, 2);
      return -2;
    }
    return null;
  },
  sharedDecisionSkills: ["jealousResponse"],
  decisions: {
    jealousHeart: (a, api) => damageTarget(a, api, 2),
    jealousResponse: (a, api) =>
      a.player.count >= a.player.limit - 1 ? cheapCards(a, api) : null,
    vanityMastery: () => true,
    envyPursuit: (a, api) =>
      a.state.players.some(
        (t) => t.team !== a.player.team && t.count > a.player.count,
      ) && usefulExtra(a, api),
  },
};
