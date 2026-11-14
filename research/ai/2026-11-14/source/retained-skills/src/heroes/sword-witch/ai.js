export const swordWitchAi = {
  id: "swordWitch",
  energyPreference: "gem",
  // Public supply value also belongs in opponents' damage evaluations. Extra
  // cards can feed successive attacks; full hands retain ordinary overflow risk.
  publicHandValue: (player) => Math.min(4, player.count) * 3,
  cardBonus: ({ card }) =>
    card.type === "attack" ? (card.fates.includes("J") ? 26 : 10) : 0,
  acceptsRefine: (a) => !a.stones.crystal,
  refineBonus: ({ player, gem }) => gem && !player.energy.gem ? Math.min(5, player.count - 2) : 0,
  resourceValue: (player) => player.energy.gem * Math.min(4, Math.max(0, player.count - 2)),
  actionBonus: ({ player, action }) => ["purchase", "synthesize"].includes(action.type)
    ? Math.max(0, 3 - player.count) * 1.5 : 0,
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
