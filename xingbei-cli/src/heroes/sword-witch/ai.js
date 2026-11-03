export const swordWitchAi = {
  id: "swordWitch",
  cardBonus: ({ card }) =>
    card.type === "attack" ? (card.fates.includes("J") ? 26 : 10) : 0,
  acceptsRefine: (a) => !a.stones.crystal,
  refineBonus: ({ player, gem }) => (gem && !player.energy.gem ? 5 : 0),
  uncounterable: ({ player, active }) =>
    active && player.heroState.attacksCompleted >= 2,
  attackHitBonus: ({ player, active, card }) =>
    active
      ? (!player.heroState.imaginaryUsed ? 5 : 0) +
        (player.hand.some(
          (c) =>
            c.type === "attack" && c.traits?.[player.id]?.fates.includes("J"),
        )
          ? 5
          : 0)
      : 0,
  decisions: {
    techniqueIntent: ({ source }) =>
      source.hand.some((c) => c.type === "attack" && c.fates.includes("J")),
    imaginarySword: () => true,
    imaginaryGain: ({ player }) => player.count < player.limit,
    swordSeverance: ({ player }) =>
      player.count >= 3 &&
      player.hand.filter((c) => c.type === "attack").length >= 2,
  },
};
