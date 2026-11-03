import { cheapCards } from "../shared/ai/decisions.js";
const uniques = ["meteor", "freeze", "fireball", "windBlade", "lightning"];
const boost = (a, api) => {
  if (a.request.type !== "cardChoice") return undefined;
  const cs = cheapCards(a, api);
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
  cardBonus: ({ card }) =>
    card.uniqueSkills.some((s) => uniques.includes(s)) ? 35 : 0,
  refineBonus: ({ player, gem }) => (!player.energy.gem && gem ? 8 : 0),
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
