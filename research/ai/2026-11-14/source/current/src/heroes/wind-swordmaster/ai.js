import { clone, value, payEnergy } from "../shared/ai/base/model.js";
import { bestAttack, expected } from "../shared/ai/base/planner.js";
import { planWindSequence, planWindState, planWindAttacks } from "./ai-wind-plan.js";

export const windSkills = ['galeArt','stormArt','windFury','swordShadow'];
export function futureWindPlan(player, { energy = player.energy.gem + player.energy.crystal } = {}) {
  return planWindSequence({ ...player, skillIds:windSkills },null,{energy});
}
export function windRefineBonus({ state, id, action }) {
  const p = state.players[id], amount = action.stones.gem + action.stones.crystal;
  const before = futureWindPlan(p), after = futureWindPlan(p,{energy:p.energy.gem+p.energy.crystal+amount});
  // Refining spends this turn. Reward a newly prepared third attack, not an
  // already funded sequence or accumulating charges without enough cards.
  // A single stone still has a small acquisition cost, even when it unlocks
  // three attacks. Preparing the same route with two stones earns the full value.
  return before.count < 3 && after.count >= 3 ? (amount === 1 ? 17.5 : 18) : 0;
}
export const heroAI = {
  specialties: ["galeArt", "stormArt"],
  skills: ["galeArt", "stormArt", "windFury", "swordShadow"],
  strongAttacker: true,
  retention({ card, elements, sameElement, copies, spellScores, score, attacks }) {
    if (card.hasUniqueSkill("galeArt")) score = 120 - copies * 9;
    else if (elements.includes("wind")) score = sameElement ? 55 : 112;
    else if (card.hasUniqueSkill("stormArt")) score = 100 - copies * 10;
    if (card.type === "attack" && attacks < 3) score += 12;
    if (card.type === "spell") score = 10 + (spellScores[card.name] ?? 0) / 10 - copies * 2;
    return score;
  },
  handBonus(p, { attacks, groups }) {
    return Math.min(3,attacks.length)*2 +
      (attacks.length >= 3 && (groups.has("wind") || attacks.some(c => c.uniqueSkills.includes("galeArt"))) ? 7 : 0);
  },
  energyUses(s, p, { attacks }) {
    return attacks >= 2 ? Array.from({ length: Math.min(2, Math.floor(attacks / 2)) }, (_, i) => ({ kind: "either", value: 8 / (1 + i * .25) })) : [];
  },
  riskForce(p) { return p.count >= 3 ? .2 : 0; },
  riskDamage(p) { return p.heroState?.oathEmpowered === 'active' ? 3 : 2; },
  attackAmount(p) { return 2 + Number(p.heroState?.oathEmpowered === 'active'); },
  storm({ card, target }) { return card.uniqueSkills.includes("stormArt") && target.effects.some(e => e.name === "holyShield"); },
  forcedHit({ active, count }) { return active && count === 2; },
  acceptsSingleRefine({game,state,id,player,action}) {
    if(state)return windRefineBonus({state,id,action})>0;
    const energy=player.energy.gem+player.energy.crystal;
    return planWindAttacks(game,id).count<3&&planWindAttacks(game,id,{energy:energy+1}).count>=3;
  },
  actionBonus({ state, id, action }) {
    if (action.type === 'refine') return windRefineBonus({state,id,action});
    const card = action.type === 'play' ? state.players[id].hand[action.index] : null;
    if (card?.type !== 'attack') return 0;
    const start = state.turn?.attackCount ?? 0;
    if (start >= 3) return 0;
    const plan = planWindState(state,id,{firstCardId:card.id});
    if (plan.count >= 3) return (3-start)*6 + plan.preference*.12 - plan.energyCost*2;
    // No three-card route: use the ordinary one-attack evaluation. The small
    // two-attack penalty discourages an unnecessary partial resource combo.
    return plan.count === 2 ? -2 : 0;
  },
  // Card sequencing is checked independently above. Do not branch over or
  // reserve speculative opponents for the second and third attacks.
  followAttacks(branches) { return branches; },
  decide({ request:r, state:s, id, context }) {
    if (r.type !== "skillChoice" || !["galeArt", "windFury", "swordShadow"].includes(r.skillId)) return;
    const plan = planWindState(s,id,{offer:r.skillId,card:context.card});
    if (plan.count >= 3 && (s.turn?.attackCount ?? 0) < 3) return plan.offers.includes(r.skillId);
    const p=s.players[id];
    if (r.skillId === 'swordShadow' && (s.turn?.pendingActions ?? []).some(a => a.type === 'attack' &&
        p.hand.some(c => c.type === 'attack' && (!a.element || (c.traits?.[id]?.elements ?? c.elements).includes(a.element))))) return false;
    const next=clone(s); if(r.skillId==='swordShadow')payEnergy(next,id);
    const best=bestAttack(next,id,{count:s.turn?.attackCount??0,depth:1,
      restriction:r.skillId==='windFury'?'wind':null,sequence:false});
    return expected(best.branches) > value(s) + (plan.count === 2 ? 2 : 0);
  },
  fallback({ request }) { if (request.type === "skillChoice" && request.skillId === "stormArt") return true; },
};
