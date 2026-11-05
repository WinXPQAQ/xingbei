import { cheapCards } from "../shared/ai/decisions.js";
const uniques = ["meteor", "freeze", "fireball", "windBlade", "lightning"];
const boost = (a, api) => {
  if (a.request.type !== "cardChoice") return undefined;
  // Additional spell damage spends an ordinary card before another spell's
  // unique skill. Search the legal ordinary costs, not just the cheapest card.
  const ordinary = (a.request.valid ?? []).filter((i) =>
    !a.source.hand[i].uniqueSkills.some((s) => uniques.includes(s)),
  );
  const cs = cheapCards({ ...a, request: { ...a.request, valid: ordinary,
    ...(a.request.validSets ? { validSets: a.request.validSets.filter((set) => set.every((i) => ordinary.includes(i))) } : {}),
  } }, api);
  if (!cs?.length) return null;
  const card = a.source.hand[cs[0]];
  return !card.uniqueSkills.some((s) => uniques.includes(s)) &&
    api.damageGain(
      a.state,
      a.id,
      a.context.targetId,
      (a.context.amount ?? 1) + 1,
    ) -
      api.damageGain(a.state, a.id, a.context.targetId, a.context.amount ?? 1) >
      3
    ? cs
    : null;
};
export const apprenticeProducerAi = {
  id: "apprenticeProducer",
  energyPreference: "gem",
  usefulCrystals: ({ state, player, action }) => {
    const red = player.energy.gem + (action?.stones?.gem ?? 0);
    return red > 0 && state.players.some((target) => target.team !== player.team &&
      target.count + red + player.energy.crystal + 1 - target.healing > target.limit) ? 1 : 0;
  },
  cardBonus: ({ card }) =>
    card.uniqueSkills.some((s) => uniques.includes(s)) ? 35 : 0,
  refineBonus: ({ state, player, gem, crystal }) => {
    // A blue stone only adds damage to a prepared Moonfall. It does not pay its
    // gem cost, and a second blue stone occupies another future gem slot.
    const ready = player.energy.gem + gem > 0 && state.players.some((target) =>
      target.team !== player.team && target.count + player.energy.gem + gem +
        player.energy.crystal + crystal - target.healing > target.limit);
    const firstBlue = player.energy.crystal === 0 ? Math.min(1, crystal) : 0;
    return (!player.energy.gem && gem ? 8 : 0) + firstBlue * (ready ? 3 : 0);
  },
  resourceValue: (p) => p.heroState.atoms * 2,
  scoreSkill({ next, id, player, action, costs, skillId, targetId }, api) {
    if (uniques.includes(skillId)) {
      api.hurt(next, targetId, skillId === "fireball" ? 2 : 1);
      return (
        (skillId === "meteor" ? 5 : skillId === "windBlade" ? 3 : 0) +
        (player.heroState.atoms < 3 ? 3 : 0)
      );
    }
    if (skillId === "moonlight") {
      api.hurt(
        next,
        targetId,
        1 + next.players[id].energy.gem + next.players[id].energy.crystal,
      );
      return 0;
    }
    if (skillId === "atomRestructure") {
      api.draw(next, id, costs.length);
      return costs.length * 2 + 2;
    }
    return null;
  },
  decisions: {
    atomAbsorption: () => true,
    ...Object.fromEntries(uniques.map((id) => [id, boost])),
  },
};
