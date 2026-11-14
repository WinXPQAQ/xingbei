import { brawlHitValue, roarOpportunity } from './ai-brawl.js';

export const delinquentGirlAi = {
  id: "delinquentGirl",
  energyPreference: "mixed",
  cardBonus: ({ card }) =>
    card.uniqueSkills?.some((s) => ["bloodBlade", "bloodyRoar"].includes(s))
      ? 25
      : card.type === "attack"
        ? 6
        : -8,
  // The guaranteed first reveal is damage 3; later reveals are an expected-value
  // correction over printed frequencies instead of a fixed 4-damage claim.
  attackDamage: () => 1,
  attackHitBonus: ({ card, targetId, state, id, active, amount }, api) =>
    brawlHitValue(state, id, targetId, card, active, api) - api.damageGain(state, id, targetId, amount, 'attack'),
  refineBonus: ({ player, gem, crystal }) => {
    const empty = player.energy.gem + player.energy.crystal === 0;
    return (empty ? 12 : 2) + gem * 3 + crystal;
  },
  actionBonus({ state, id, player, action }, api) {
    const card = action.type === 'play' ? player.hand[action.index] : null;
    if (card?.type !== 'attack') return 0;
    return 4 + roarOpportunity(state, id, action.targetId, card, api);
  },
  decisions: {
    bloodBlade: () => true,
    delinquentRoar: () => true,
    recklessBrawl: ({ request, state, id, context }, api) => {
      const best = request.choices
        .filter((c) => c.value)
        .map((c) => ({
          value: c.value,
          gain:
            api.damageGain(
              state,
              id,
              context.targetId,
              context.amount + (c.value === "gem" ? 2 : 1),
              "attack",
            ) -
            api.damageGain(state, id, context.targetId, context.amount, "attack") -
            (c.value === "gem" ? 5 : 3),
        }))
        .sort((a, b) => b.gain - a.gain)[0];
      return best?.gain > 0 ? best.value : null;
    },
  },
};
