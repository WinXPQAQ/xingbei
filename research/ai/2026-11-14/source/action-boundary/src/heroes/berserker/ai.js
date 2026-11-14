import { clone, value, damage, payEnergy } from "../shared/ai/base/model.js";

export const heroAI = {
  specialties: ["bloodBlade", "bloodyRoar"],
  skills: ["bloodBlade", "bloodyRoar", "rend"],
  strongAttacker: true,
  estimatedCounterDamage: 3,
  retention({ card, spellScores, copies, score }) {
    return card.type === "spell" ? 10 + (spellScores[card.name] ?? 0) / 10 - copies * 2 : score;
  },
  energyUses(s, p, { attacks }) {
    return Array.from({ length: Math.min(3, Math.ceil(attacks)) }, (_, i) => ({ kind: "gem", value: 8 / (1 + i * .25) }));
  },
  energySlots(p, unmet) { return unmet.slice(0, Math.max(0, 3 - p.energy.crystal)); },
  acceptsCrystalRefinement: () => false,
  actionBonus({ state, id, action }) {
    const player = state.players[id];
    if (action.type === 'refine') {
      const { gem, crystal } = action.stones;
      const attacks = player.hand.filter(card => card.type === 'attack').length;
      // Rend is reusable on future hits. Prepare it early, but do not pay a
      // permanent crystal slot for an ability that only consumes gems.
      return crystal ? -24 * crystal : gem ? (player.energy.gem === 0 ? 14 : 3) + Math.min(3, attacks) * 2 : 0;
    }
    const card = action.type === 'play' ? player.hand[action.index] : null;
    return card?.type === 'attack' ? 4 : 0;
  },
  riskDamage(p) { return 3 + (p.energy.gem ? 1 : 0); },
  forecastDamage(p, count) { return 3 + Number(count > 3) + 2 * Number(p.energy.gem > 0); },
  attackAmount(p) { return 3 + Number(p.count > 3); },
  forcedHit({ card, target, active }) { return active && card.uniqueSkills.includes("bloodyRoar") && target.healing === 2; },
  attackBonus({ card, target, active }) { return active && card.uniqueSkills.includes("bloodBlade") ? target.count === 2 ? 2 : target.count === 3 ? 1 : 0 : 0; },
  improveHit(s, id, targetId, amount, hit) {
    if (s.players[id].energy.gem > 0) {
      const next = clone(s); payEnergy(next, id, 1, "gem"); damage(next, targetId, amount + 2, "attack", { sourceId: id });
      const team = s.players[targetId].team;
      if (next.teams[team].morale < hit.teams[team].morale && value(next) > value(hit)) return next;
    }
    return hit;
  },
  decide({ request: r, state: s, id, context }) {
    if (r.type === "skillChoice" && r.skillId === "rend") {
      const a = clone(s), b = clone(s); damage(a, context.targetId, context.amount, "attack", { sourceId: id });
      payEnergy(b, id, 1, "gem"); damage(b, context.targetId, context.amount + 2, "attack", { sourceId: id });
      const team = s.players[context.targetId].team;
      return b.teams[team].morale < a.teams[team].morale && value(b) > value(a);
    }
  },
  fallback({ request }) {
    if (request.type === "skillChoice" && ["bloodBlade", "bloodyRoar"].includes(request.skillId)) return true;
  },
};
