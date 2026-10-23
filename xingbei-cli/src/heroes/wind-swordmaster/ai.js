import { clone, value, payEnergy } from "../shared/ai/base/model.js";
import { bestAttack, expected } from "../shared/ai/base/planner.js";

export const heroAI = {
  specialties: ["galeArt", "stormArt"],
  skills: ["galeArt", "stormArt", "windFury", "swordShadow"],
  strongAttacker: true,
  retention({ card, elements, sameElement, copies, spellScores, score }) {
    if (card.hasUniqueSkill("galeArt")) score = 120 - copies * 9;
    else if (elements.includes("wind")) score = sameElement ? 55 : 112;
    else if (card.hasUniqueSkill("stormArt")) score = 100 - copies * 10;
    if (card.type === "spell") score = 10 + (spellScores[card.name] ?? 0) / 10 - copies * 2;
    return score;
  },
  handBonus(p, { attacks, groups }) { return attacks.length >= 2 && (groups.has("wind") || attacks.some(c => c.uniqueSkills.includes("galeArt"))) ? 4 : 0; },
  energyUses(s, p, { attacks }) {
    return attacks >= 2 ? Array.from({ length: Math.min(2, Math.floor(attacks / 2)) }, (_, i) => ({ kind: "either", value: 8 / (1 + i * .25) })) : [];
  },
  riskForce(p) { return p.count >= 3 ? .2 : 0; },
  riskDamage(p) { return p.count >= 3 ? 3 : 2; },
  storm({ card, target }) { return card.uniqueSkills.includes("stormArt") && target.effects.some(e => e.name === "holyShield"); },
  forcedHit({ active, count }) { return active && count === 2; },
  followAttacks(branches, id, card, { count, depth, sequence, budget }) {
    if (!sequence || depth <= 1 || count >= 2) return branches;
    return branches.flatMap(b => {
      const p = b.state.players[id], choices = [{ restriction: null, cost: 0, skill: card.uniqueSkills.includes("galeArt") ? "galeArt" : null }];
      if (!b.state.turn?.usedSkills?.windFury) choices.push({ restriction: "wind", cost: 0, skill: "windFury" });
      if (!b.state.turn?.usedSkills?.swordShadow && p.energy.gem + p.energy.crystal) choices.push({ restriction: null, cost: 1, skill: "swordShadow" });
      let follow = { branches: [{ probability: 1, state: b.state, path: [] }], score: 0 };
      for (const option of choices.filter(o => o.skill)) {
        const next = clone(b.state); if (option.cost) payEnergy(next, id);
        next.turn ??= { usedSkills: {} }; next.turn.usedSkills ??= {}; next.turn.usedSkills[option.skill] = true;
        const found = bestAttack(next, id, { count: count + 1, depth: depth - 1, restriction: option.restriction, sequence, budget });
        const gain = found.total - value(b.state); if (gain > follow.score) follow = { ...found, score: gain };
      }
      return follow.branches.map(f => ({ probability: b.probability * f.probability, state: f.state, path: [...b.path, ...f.path], steps: [...(b.steps ?? []), ...(f.steps ?? [])] }));
    });
  },
  decide({ request: r, state: s, id, player: p, sequence }) {
    if (r.type !== "skillChoice" || !["galeArt", "windFury", "swordShadow"].includes(r.skillId)) return;
    if (r.skillId === "swordShadow" && (s.turn?.pendingActions ?? []).some(a => !a.element || p.hand.some(c => c.type === "attack" && c.elements.includes(a.element)))) return false;
    const next = clone(s); if (r.skillId === "swordShadow") payEnergy(next, id);
    next.turn ??= { usedSkills: {} }; next.turn.usedSkills ??= {}; next.turn.usedSkills[r.skillId] = true;
    const best = bestAttack(next, id, { count: s.turn?.attackCount ?? 0, depth: Math.max(1, 3 - (s.turn?.attackCount ?? 0)), restriction: r.skillId === "windFury" ? "wind" : null, sequence });
    return expected(best.branches) > value(s);
  },
  fallback({ request }) { if (request.type === "skillChoice" && request.skillId === "stormArt") return true; },
};
