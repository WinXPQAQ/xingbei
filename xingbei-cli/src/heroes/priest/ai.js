import { clone, value, heal, payEnergy, transfer, overflow, traits, damage } from "../shared/ai/base/model.js";
import { hasSpecialty, aiHeroId, strongEnemyBeforeTurn } from "../shared/ai/base/evaluation.js";

export function contractOption(s, id, { reservedEnergy = 0, reservedHealing = 0, targetId = null } = {}) {
  const p = s.players[id]; let best = { state: s, targetId: null, count: 0, total: value(s) };
  if (p.hero !== "priest" || p.energy.gem + p.energy.crystal <= reservedEnergy) return best;
  for (const target of s.players.filter(t => t.team === p.team && t.id !== id && (targetId === null || t.id === targetId))) {
    for (let n = 1; n <= Math.min(p.healing - reservedHealing, Math.max(0, 4 - target.healing)); n++) {
      const next = clone(s); payEnergy(next, id); next.players[id].healing -= n; next.players[target.id].healing += n;
      const total = value(next); if (total > best.total) best = { state: next, targetId: target.id, count: n, total };
    }
  }
  return best;
}
export const heroAI = {
  specialties: [],
  skills: ["holyContract", "waterPower", "prayer", "sacredDomain", "revelation"],
  healingCap: 1,
  retention({ game, playerId, player, card, elements, sameElement, spells, spellScores, score }) {
    if (elements.includes("water")) score = Math.max(score, sameElement ? 65 : 110);
    if (card.type === "spell") score = spells < 2 ? 99 + ((spellScores[card.name] ?? 52) - 52) / 2 : (strongEnemyBeforeTurn(game, playerId) ? 64 : 79) - spells;
    if (card.type === "attack" && !sameElement && strongEnemyBeforeTurn(game, playerId)) score = Math.max(score, 90);
    if (game.players.some(other => other.team === player.team && other.id !== playerId && other.hand.length < other.handLimit && hasSpecialty(aiHeroId(other), card))) score = Math.max(score, 68);
    return score;
  },
  handBonus(p, { cards }) { return cards.some(c => traits(c, p.id).includes("water")) && cards.length >= 2 ? 4 : 0; },
  energyUses(s, p) { return p.count >= 2 ? Array.from({ length: Math.min(2, Math.floor(p.count / 2)) }, (_, i) => ({ kind: "either", value: 8 / (1 + i * .25) })) : []; },
  riskRelief(p) { return p.count >= 2 ? .25 : 0; },
  cupPreparation(p) { return p.count >= 4 ? .2 : 0; },
  energySkills: ["sacredDomain"],
  hiddenCostSkills: ["sacredDomain"],
  afterSpecial(next, id) { heal(next, id, 1); },
  afterGift(next, id, targetId, skillId) { if (skillId === "waterPower") { heal(next, id, 1); heal(next, targetId, 1); } },
  planActivation(s, id, action, { sequence, baseTotal, contracts, actionPlan }) {
    if (s.turn?.activationDone || !["play", "skill"].includes(action.type)) return;
    const reservedEnergy = action.skillId === "sacredDomain" ? 1 : 0, reservedHealing = action.skillId === "sacredDomain" && action.mode === "damage" ? 1 : 0, key = `${reservedEnergy}:${reservedHealing}`;
    let option = contracts?.get(key);
    if (!option) { option = contractOption(s, id, { reservedEnergy, reservedHealing }); contracts?.set(key, option); }
    if (!option.count) return;
    const next = clone(option.state); next.turn ??= {}; next.turn.activationDone = true; const plan = actionPlan(next, id, action, { sequence });
    const step = { type: "skillResponse", actorId: id, targetId: option.targetId, skillId: "holyContract", count: option.count, result: `transfer ${option.count} healing` };
    const prefix = branches => branches?.map(b => ({ ...b, path: ["holyContract", ...b.path], steps: [step, ...(b.steps ?? [])] }));
    return { ...plan, score: plan.total - baseTotal, branches: prefix(plan.branches), primaryBranches: prefix(plan.primaryBranches) };
  },
  resolveAction(next, id, action, { target }) {
    if (action.skillId === "waterPower") {
      const actor = next.players[id], candidates = actor.hand.map(card => {
        const t = clone(next); transfer(t, id, target, card); heal(t, id, 1); heal(t, target, 1); overflow(t, target); return t;
      });
      if (actor.count > actor.hand.length) { const t = clone(next); t.players[id].count--; t.players[target].count++; heal(t, id, 1); heal(t, target, 1); overflow(t, target); candidates.push(t); }
      if (!actor.count) { heal(next, id, 1); heal(next, target, 1); candidates.push(next); }
      return candidates.map(state => ({ state, total: value(state) })).sort((a, b) => b.total - a.total)[0].state;
    }
    if (action.skillId === "prayer") heal(next, id, 2);
    if (action.skillId === "sacredDomain") {
      if (action.mode === "damage") { next.players[id].healing--; damage(next, target, 2); }
      else { heal(next, id, 2); heal(next, target, 1); }
    }
    return next;
  },
  decide({ request: r, state: s, id }) {
    if (r.skillId !== "holyContract") return;
    const option = contractOption(s, id, { reservedEnergy: r.reservedEnergy ?? s.turn?.reservedEnergy ?? 0, reservedHealing: r.reservedHealing ?? s.turn?.reservedHealing ?? 0, targetId: r.type === "numberChoice" ? r.targetId : null });
    if (r.type === "skillChoice") return option.count > 0;
    if (r.type === "playerChoice") return option.targetId ?? r.defaultValue;
    if (r.type === "numberChoice") return option.count || r.choices[0]?.value;
  },
  fallback({ request }) { if (request.type === "skillChoice" && request.skillId === "revelation") return true; },
};
