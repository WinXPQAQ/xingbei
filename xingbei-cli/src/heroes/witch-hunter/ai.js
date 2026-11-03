import {
  damageTarget,
  discardTarget,
  cheapCovered,
} from "../shared/ai/decisions.js";
export const witchHunterAi = {
  id: "witchHunter",
  cardBonus: ({ card, retained }) =>
    card.type === "spell" &&
    retained.filter((c) => c.type === "spell").length < 3
      ? 12
      : 0,
  resourceValue: (p) => (p.coveredCount ?? 0) * 3,
  refineBonus: ({ crystal, player }) =>
    crystal && !player.energy.crystal ? 5 : 0,
  scoreSkill({ game, state, next, id, skillId, costs, targetId }, api) {
    if (skillId !== "spellConversion") return null;
    const card = game.cards.get(costs[0].id);
    const converted = {
      ...card,
      name: `${card.getTraits({ playerId: id }).elements[0]}Strike`,
      type: "attack",
      uniqueSkills: [],
    };
    return (
      api.attackScore(game, id, state, converted, targetId) +
      api.evaluate(state) -
      api.evaluate(next) +
      api.cardCost(game, id, [card])
    );
  },
  decisions: {
    witchSting: () => true,
    spellStrip: () => true,
    spellStripTarget: discardTarget,
    silverVenom: (a, api) =>
      a.player.healing < a.player.healingLimit ? cheapCovered(a, api) : null,
    ambush: cheapCovered,
    ambushTargets: damageTarget,
    ambushSame: damageTarget,
  },
};
