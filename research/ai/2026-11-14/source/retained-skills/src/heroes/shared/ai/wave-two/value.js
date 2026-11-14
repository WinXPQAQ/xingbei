import { actionPlan, bestAttack } from "../base/planner.js";
import { heroPolicies } from "./registry.js";

export const sumEnergy = (p) => p.energy.gem + p.energy.crystal;
export const sign = (g, id, target) =>
  g.player(id).team === g.player(target).team ? 1 : -1;
export const healingValue = (g, id, target, n = 1) =>
  sign(g, id, target) *
  Math.min(
    n,
    Math.max(0, g.getHealingLimit(target) - g.player(target).healing),
  ) *
  2.5;
export const bestHeal = (g, id, n = 1) =>
  Math.max(0, ...g.players.map((p) => healingValue(g, id, p.id, n)));
export function continuation(s, id, type) {
  if (type === "attack")
    return Math.max(0, bestAttack(s, id, { depth: 1, sequence: false }).score);
  // One bounded extra spell; no repeated ignition/extra-action recursion.
  let best = 0;
  for (const [index, c] of s.players[id].hand.entries())
    if (c.type === "spell" && c.name !== "holyLight")
      for (const t of s.players) {
        if (c.name === "holyShield" && t.team !== s.players[id].team) continue;
        if (c.name !== "holyShield" && t.team === s.players[id].team) continue;
        if (
          c.name === "holyShield" &&
          t.effects.some((e) => e.name === "holyShield")
        )
          continue;
        best = Math.max(
          best,
          actionPlan(
            s,
            id,
            { type: "play", index, targetId: t.id },
            { sequence: false },
          ).score,
        );
      }
  // Unique attacks can become elemental/saint spells; value having a real follow-up.
  if (Object.values(heroPolicies()).some((policy) => policy.hasSpellContinuation?.(s.players[id])))
    best = Math.max(best, 3);
  return best;
}
