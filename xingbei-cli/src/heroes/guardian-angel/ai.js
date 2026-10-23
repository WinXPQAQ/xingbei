import { clone, value, heal, payEnergy, overflow, effectValue } from "../shared/ai/base/model.js";
import { removeEffectOptions } from "../shared/ai/base/planner.js";
import { cardScore } from "../shared/ai/base/evaluation.js";

export function angelBond(s) {
  let best = s, bestTotal = value(s);
  for (const target of s.players) {
    const next = clone(s); heal(next, target.id, 1); const total = value(next);
    if (total > bestTotal) { best = next; bestTotal = total; }
  }
  return best;
}
export const heroAI = {
  specialties: ["angelWall"],
  optionSkills: ["angelWall"],
  skills: ["angelWall", "angelBlessing", "windCleansing", "angelBond", "angelSong", "holySword", "divineShelter"],
  retention({ elements, sameElement, score }) { return elements.some(e => ["wind", "water"].includes(e)) ? Math.max(score, sameElement ? 30 : 90) : score; },
  specialtyOptionValue(s, p) {
    return p.skillIds?.includes("angelWall") && p.hand.some(c => c.uniqueSkills.includes("angelWall")) && s.players.some(t => !t.effects.some(e => e.name === "holyShield")) ? 2 : 0;
  },
  energyUses(s, p) {
    const removable = s.players.flatMap(t => t.effects.filter(e => e.name !== "fivefoldBinding" && effectValue(s, t, e) * (t.team === p.team ? 1 : -1) < 0));
    return Array.from({ length: Math.min(2, removable.length) }, (_, i) => ({ kind: "either", value: 7 / (1 + i * .25) }));
  },
  energyValue(s, p, weights) { return (p.energy.gem + p.energy.crystal) * weights.stone; },
  protectsSpellOverflow: true,
  afterShield: angelBond,
  afterEffectRemoval: angelBond,
  effectSelection: { windCleansing: { take: false } },
  resolveAction(next, id, action, { target, costs, selectedEffect, effect }) {
    if (action.skillId === "angelWall") { effect(next, target, "holyShield", costs[0]); return angelBond(next); }
    if (action.skillId === "windCleansing") return removeEffectOptions(next, id, [target], { take: false }).find(e => e.id === selectedEffect)?.state ?? next;
    if (action.skillId === "angelBlessing") {
      for (const t of action.targetIds) { const n = Math.min(next.players[t].count, action.targetIds.length === 1 ? 2 : 1); next.players[t].count -= n; next.players[id].count += n; }
      overflow(next, id);
    }
    return next;
  },
  decide({ request: r, state: s, id }) {
    if (r.type === "playerChoice" && r.skillId === "angelBond") {
      return [...r.choices].sort((a, b) => { const score = choice => { const next = clone(s); heal(next, choice.value, 1); return value(next); }; return score(b) - score(a); })[0]?.value ?? r.defaultValue;
    }
    if (r.type === "skillChoice" && r.skillId === "angelSong") {
      const next = clone(s); payEnergy(next, id);
      return (removeEffectOptions(next, id, s.players.map(p => p.id))[0]?.state ? value(removeEffectOptions(next, id, s.players.map(p => p.id))[0].state) : -Infinity) > value(s);
    }
  },
  fallback({ request, game, player }) {
    if (request.type === "numberChoice" && request.skillId === "divineShelter") return request.choices.at(-1).value;
    if (request.type === "numberChoice" && request.skillId === "holySword") return Math.min(3, player.hand.filter(card => cardScore(game, player.id, card, player.hand.filter(other => other !== card)) < 75).length);
  },
};
