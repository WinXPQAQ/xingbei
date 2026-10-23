import { clone, value, difference, spend, damage, draw, cardData, traits } from "../shared/ai/base/model.js";
import { expected, attackBranches } from "../shared/ai/base/planner.js";

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
  energyUses(s, p, { attacks, enemies }) { return attacks >= 1 && enemies.some(t => t.count < 5) ? [{ kind: "either", value: 7 }] : []; },
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
      return expected(attackBranches(base, id, card, context.targetId, { precision: true, sequence: false })) > expected(attackBranches(base, id, card, context.targetId, { precision: false, sequence: false }));
    }
  },
};
