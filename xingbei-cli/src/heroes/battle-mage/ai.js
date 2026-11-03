import { damageTarget } from "../shared/ai/decisions.js";
export const battleMageAi = {
  id: "battleMage",
  cardBonus: ({ card, retained }) =>
    card.fates.includes("Y")
      ? 14
      : card.type === "spell" &&
          retained.filter((c) => c.type === "spell").length < 2
        ? 8
        : 0,
  refineBonus: ({ player, crystal }) =>
    crystal && !player.energy.crystal ? 5 : 0,
  scoreSkill({ next, id, player, skillId, costs }, api) {
    if (skillId !== "runeExchange") return null;
    api.draw(next, id, 1);
    return costs.some(
      (c) => c.type === "spell" || c.traits[id]?.fates.includes("Y"),
    ) && player.hand.some((c) => c.type === "attack")
      ? 7
      : 0;
  },
  attackHitBonus({ player, active }) {
    return active && !player.heroState.enchantedStrikeUsed ? 5 : 0;
  },
  decisions: {
    enchantedStrike: () => true,
    entropyShift: () => true,
    entropyTargets: damageTarget,
    entropyCost: ({ request }) =>
      request.choices.find((c) => String(c.value).endsWith(":crystal"))
        ?.value ?? request.choices[0].value,
    manaEntropy: ({ player, state }) =>
      state.teams[player.team].total < 5 ||
      state.players.some((p) => p.team !== player.team && p.count >= p.limit),
    manaEntropyTarget: damageTarget,
  },
};
