import {
  cheapCovered,
  damageTarget,
  discardTarget,
} from "../shared/ai/decisions.js";
export const barrierMasterAi = {
  id: "barrierMaster",
  sharedDecisionSkills: ["whiteKarma", "karmaCard"],
  cardBonus: ({ card, elements, same }) =>
    card.type === "attack" && !same ? 5 : 0,
  resourceValue: (p) =>
    (p.heroState.ritual ?? 0) * 3 +
    (p.coveredCount ?? 0) * 3 +
    (p.heroState.form ? 4 : 0),
  refineBonus: ({ player, crystal }) =>
    crystal && !player.energy.crystal ? 5 : 0,
  scoreSkill({ next, id, player, skillId, targetId, costs }, api) {
    if (skillId === "barrierRitual") {
      player.coveredCount = 2;
      player.heroState.ritual = Math.min(3, player.heroState.ritual + 1);
      return 3;
    }
    if (skillId === "forbiddenRealm") {
      player.heroState.ritual--;
      api.discardEstimate(next, id, 1);
      const target = next.players[targetId];
      return target.team === player.team
        ? target.effects.filter((e) => ["poison", "weakness"].includes(e.name))
            .length *
            7 +
            2
        : target.effects.some((e) => e.name === "holyShield")
          ? 5
          : -6;
    }
    return null;
  },
  decisions: {
    wildGodRite: () => true,
    riteRelease: ({ player }) =>
      !player.heroState.form && player.coveredCount > 1,
    removeBarrier: cheapCovered,
    glassRealm: () => true,
    glassTarget: discardTarget,
    glassKeep: () => true,
    whiteKarma: ({ player }) => player.count < player.limit,
    karmaCard: cheapCovered,
    banishingRealm: ({ state, player }) =>
      state.players.some(
        (p) => p.team !== player.team && p.count >= p.limit && p.healing === 0,
      ),
    banishingTarget: damageTarget,
  },
};
