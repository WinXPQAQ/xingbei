import { clone, value, difference, spend, damage, draw, cardData, traits, burden, weights } from "../shared/ai/base/model.js";
import { expected, attackBranches } from "../shared/ai/base/planner.js";

const snipeReadiness = (player, target) => player.team === target.team
  ? Math.max(0, Math.min(5 - target.count, target.limit - target.count, 3 - target.count)) * 2.5 : 0;

// A public readiness estimate for storing a snipe charge. Do not call value()
// here: energy valuation itself asks this function about future energy uses.
export function estimateSnipeValue(state, player, target) {
  const amount = Math.max(0, 5 - target.count);
  if (!amount) return 0;
  const excess = Math.max(0, target.count + amount - target.limit);
  const kept = amount - excess, after = target.count + kept;
  const hand = kept * weights.unknown - burden(after, target.limit) + burden(target.count, target.limit);
  const friendly = player.team === target.team;
  // Empty hands lack both an ordinary action and response options. This is a
  // count-based need estimate; teammates' actual card identities stay unknown.
  const readiness = snipeReadiness(player, target);
  const sign = friendly ? 1 : -1;
  const terminal = excess >= state.teams[target.team].morale ? 200 : 0;
  return sign * (hand - excess * weights.morale - terminal) + readiness;
}

function hitResourceValue(state, id, branches) {
  const player = state.players[id], team = state.teams[player.team];
  const need = state.players.filter(p => p.team === player.team && p.id !== id && !p.energy.gem && !p.energy.crystal).length;
  if (!need || team.gem + team.crystal >= 5) return 0;
  return branches.reduce((sum, branch) => sum + branch.probability *
    Math.max(0, branch.state.teams[player.team].gem - team.gem), 0) * need * 1.5;
}

export function piercingOptions(s, id, targetId, allowed = null) {
  const result = [{ card: null, state: clone(s), score: 0, parts: difference(s, s) }];
  for (const card of s.players[id].hand.filter(c => c.type === "spell" && (!allowed || allowed.includes(c.id)))) {
    const next = clone(s); spend(next, id, [card]);
    if (!Object.values(next.teams).some(t => t.morale <= 0 || t.cups >= 5)) damage(next, targetId, 2);
    result.push({ card: card.id, state: next, score: value(next) - value(s), parts: difference(s, next) });
  }
  return result.sort((a, b) => b.score - a.score);
}
export const heroAI = {
  energyPreference: "crystal",
  specialties: ["flashTrap", "precisionShot"],
  optionSkills: ["flashTrap", "precisionShot"],
  skills: ["flashTrap", "precisionShot", "piercingShot", "snipe"],
  minimumAttacks: 2,
  retention({ player, card, elements, spells, attacks, copies, sameElement, spellScores, score }) {
    if (card.type === "spell") score = spells >= Math.floor(player.handLimit / 2) ? 12 : 84 + ((spellScores[card.name] ?? 52) - 52) / 2 - spells * 7;
    if (card.type === "attack" && attacks < 2) score += 22;
    if (card.hasUniqueSkill("flashTrap")) score = 115 - copies * 10 + (attacks < 2 ? 22 : 0);
    else if (card.hasUniqueSkill("precisionShot")) score = 90 - copies * 10 + (attacks < 2 ? 22 : 0);
    if (elements.includes("thunder")) score = Math.max(score, sameElement ? 45 : 95);
    return score;
  },
  specialtyOptionValue(s, p) {
    return Number(!!(p.skillIds?.includes("flashTrap") && p.hand.some(c => c.uniqueSkills.includes("flashTrap")) && s.players.length)) * 2 +
      Number(!!(p.skillIds?.includes("precisionShot") && p.hand.some(c => c.type === "attack" && c.uniqueSkills.includes("precisionShot")) && s.players.some(t => t.team !== p.team))) * 2;
  },
  energyUses(s, p, { attacks }) {
    const opportunity = Math.max(0, ...s.players.map(target => estimateSnipeValue(s, p, target)));
    if (opportunity <= 0 && attacks < 1) return [];
    const ready = Math.max(0, opportunity * .55 + Math.min(2, attacks) * 2);
    return ready > 0 ? [{ kind: "either", value: ready }, { kind: "either", value: ready * .4 }] : [];
  },
  actionBonus({ state, id, player, action, plan }) {
    if (action.type === "skill" && action.skillId === "snipe") return snipeReadiness(player, state.players[action.targetIds[0]]);
    if (action.type !== "play" || player.hand[action.index]?.type !== "attack" || !plan?.branches) return 0;
    // Reward the gem only on the branches that actually hit; precision and
    // lightning compete with ordinary attacks on the same outcome estimate.
    return hitResourceValue(state, id, plan.branches);
  },
  riskForce() { return .15; },
  giftValue(s, p, card) { return traits(card, p.id).includes("thunder") ? 1.5 : 0; },
  canCounter(elements) { return !elements.includes("thunder"); },
  precisionOptions(card) { return card.uniqueSkills.includes("precisionShot") ? [false, true] : [false]; },
  afterMiss(s, id, targetId, path) {
    const best = piercingOptions(s, id, targetId)[0]; if (best.card) path.push(`piercing:${best.card}`); return best.state;
  },
  energySkills: ["snipe"],
  resolveAction(next, id, action, { target }) {
    if (action.skillId === "flashTrap") damage(next, target, 2);
    else if (action.skillId === "snipe") draw(next, target, Math.max(0, 5 - next.players[target].count));
    return next;
  },
  followsSpell(spell, action) { return action.skillId === "snipe"; },
  decide({ request: r, state: s, id, player: p, context }) {
    if (r.type === "cardChoice" && r.skillId === "piercingShot") {
      const best = piercingOptions(s, id, context.targetId, r.valid.map(i => p.hand[i].id))[0];
      return best.card ? [p.hand.findIndex(c => c.id === best.card)] : null;
    }
    if (r.type === "skillChoice" && r.skillId === "precisionShot") {
      const card = context.card ? cardData(context.card) : null; if (!card) return false;
      const base = clone(s); base.players[id].hand.push(card); base.players[id].count++;
      const active = !context.isCounter;
      const score = precision => {
        const branches = attackBranches(base, id, card, context.targetId, { precision, sequence: false, active });
        return expected(branches) + (active ? hitResourceValue(base, id, branches) : 0);
      };
      return score(true) > score(false);
    }
  },
};
