import { heal } from "../shared/ai/base/model.js";
import { sign, sumEnergy, bestHeal, continuation } from "../shared/ai/wave-two/value.js";

const uniqueSkills = ["healingArt", "healingLight"];
function retentionBonus(g, id, card, { elements, same }) {
  if (uniqueSkills.some((skill) => card.hasUniqueSkill(skill))) return 5;
  return elements.includes("water") ? same ? 1 : 3 : 0;
}
function scoreSkill({ game: g, id, action, state: n, costs }) {
  const targets = action.targetIds ?? [], skill = action.skillId;
  let bonus = 0;
  if (skill === "healingArt") heal(n, targets[0], 2);
  if (skill === "healingLight") for (const target of targets) heal(n, target, 1);
  if (skill === "holyCure") {
    for (const target of targets) heal(n, target, 1);
    for (let i = targets.length; i < 3; i++) {
      const target = [...targets].sort((a, b) =>
        sign(g, id, b) * Math.max(0, n.players[b].healingLimit - n.players[b].healing) -
        sign(g, id, a) * Math.max(0, n.players[a].healingLimit - n.players[a].healing),
      )[0];
      heal(n, target, 1);
    }
    bonus += Math.max(continuation(n, id, "attack"), continuation(n, id, "spell"));
  }
  if (costs.some((card) => card.elements.includes("water") || card.name === "holyLight") && uniqueSkills.includes(skill)) bonus += bestHeal(g, id);
  return { bonus };
}
function chooseRuleDecision(request, g, state) {
  const id = request.playerId ?? request.player?.id, player = g.player(id);
  if (request.type === "numberChoice" && request.skillId === "holyCure" && request.choices.some((choice) => choice.value === "spell")) {
    return continuation(state, id, "spell") > continuation(state, id, "attack") ? "spell" : "attack";
  }
  if (request.type === "skillChoice" && request.skillId === "compassion") return !player.hero.state?.compassion && sumEnergy(player) > (request.reservedEnergy ?? 0);
}
export function prepareMagic(g, id, state, card) {
  if (!state.players[id].skillIds.includes("frostPrayer") || !card.getTraits({ game: g, playerId: id }).elements.includes("water")) return;
  const recipient = state.players.filter((player) => player.team === state.players[id].team && player.healing < player.healingLimit)
    .sort((a, b) => b.count - a.count || a.id - b.id)[0];
  if (recipient) recipient.healing++;
}
export const saintAi = {
  retentionBonus, scoreSkill, chooseRuleDecision,
  playBonus: (g, id, card) => card.getTraits({ game: g, playerId: id }).elements.includes("water") || card.name === "holyLight" ? bestHeal(g, id) : 0,
  hasSpellContinuation: (player) => player.hand.some((card) => card.uniqueSkills.some((skill) => player.skillIds.includes(skill) && uniqueSkills.includes(skill))),
};
