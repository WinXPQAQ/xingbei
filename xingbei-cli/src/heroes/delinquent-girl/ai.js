export const delinquentGirlAi = {
  id: "delinquentGirl",
  cardBonus: ({ card }) =>
    card.uniqueSkills?.some((s) => ["bloodBlade", "bloodyRoar"].includes(s))
      ? 25
      : card.type === "attack"
        ? 6
        : -8,
  attackDamage: () => 2,
  attackHitBonus: ({ card, targetId, state }) =>
    card.uniqueSkills?.includes("bloodBlade") &&
    [2, 3].includes(state.players[targetId].count)
      ? 9
      : 0,
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
            ) -
            api.damageGain(state, id, context.targetId, context.amount) -
            (c.value === "gem" ? 5 : 3),
        }))
        .sort((a, b) => b.gain - a.gain)[0];
      return best?.gain > 0 ? best.value : null;
    },
  },
};
