import { clone, value, traits, damage } from "../shared/ai/base/model.js";
import { bestAttack, expected, removeEffectOptions } from "../shared/ai/base/planner.js";

export const isBinding = effect => effect.name === "fivefoldBinding";
export const sealsCard = (player, card) => player.effects.some(effect =>
  effect.name.endsWith("Seal") && traits(card, player.id).includes(effect.name.slice(0, -4)));
export function bindingDrawAmount(state, player) {
  return 2 + Math.min(2, state.players.flatMap(p => p.effects).filter(e => e.name.endsWith("Seal")).length) + (player.effects.some(e => e.name === "weakness") ? 3 : 0);
}
export function sealEffectValue(s, p, effect) {
  if (!effect.name.endsWith("Seal")) return;
  const element = effect.name.slice(0, -4), known = p.id === s.observer ? p.hand : p.known;
  const share = p.id === s.observer ? known.filter(c => traits(c, p.id).includes(element)).length / Math.max(1, p.count) : .2;
  return -(2 + Math.max(0, p.count - 3) * 2) * share;
}
export function exposeSeals(s, id, cards) {
  const p = s.players[id];
  for (const effect of [...p.effects]) if (effect.name.endsWith("Seal") && cards.some(c => traits(c, id).includes(effect.name.slice(0, -4)))) {
    p.effects = p.effects.filter(e => e !== effect); damage(s, id, 3);
  }
}
export const heroAI = {
  specialties: ["earthSeal", "waterSeal", "fireSeal", "windSeal", "thunderSeal"],
  skills: ["fivefoldBinding", "sealBreaking", "spellExcitation"],
  matchesSkill: id => typeof id === "string" && id.endsWith("Seal"),
  minimumAttacks: 2,
  retention({ player, card, spells, attacks, spellScores, score }) {
    if (card.type === "spell") score = spells >= Math.floor(player.handLimit / 2) ? 12 : 77 + ((spellScores[card.name] ?? 52) - 52) / 2 - spells * 7;
    if (card.type === "attack" && attacks < 2) score += 22;
    return score;
  },
  energyUses(s, p) {
    const uses = [];
    if (!s.players.some(t => t.effects.some(e => e.name === "fivefoldBinding" && e.id === `fivefoldBinding-${p.id}`))) uses.push({ kind: "either", value: 7 });
    if (s.players.some(t => t.effects.length)) uses.push({ kind: "either", value: 6 });
    return uses;
  },
  giftValue(s, p, card) { return ["magicBullet", "holyShield"].includes(card.name) ? Math.max(0, Math.min(3, p.count - 1)) * 2 : 0; },
  energySkills: ["fivefoldBinding", "sealBreaking"],
  effectSelection: { sealBreaking: { take: true } },
  resolveAction(next, id, action, { target, costs, selectedEffect, effect }) {
    if (action.skillId === "sealBreaking") return removeEffectOptions(next, id, [target], { take: true }).find(e => e.id === selectedEffect)?.state ?? next;
    if (action.skillId.endsWith("Seal") || action.skillId === "fivefoldBinding") effect(next, target, action.skillId, costs[0]);
    return next;
  },
  followsSpell(spell) { return spell; },
  decide({ request: r, state: s, id, sequence }) {
    if (r.type === "skillChoice" && r.skillId === "spellExcitation") {
      const next = clone(s); next.turn ??= { usedSkills: {} }; next.turn.usedSkills ??= {}; next.turn.usedSkills[r.skillId] = true;
      return expected(bestAttack(next, id, { count: s.turn?.attackCount ?? 0, depth: Math.max(1, 3 - (s.turn?.attackCount ?? 0)), restriction: null, sequence }).branches) > value(s);
    }
  },
};
