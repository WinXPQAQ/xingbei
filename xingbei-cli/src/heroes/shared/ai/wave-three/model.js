import { playableCards } from "../../../../playable-cards.js";
import { cardData } from "../base/model.js";
// Small public-state estimates. They never execute a rule or invent future cards.
import { stateOf, clone, value, draw, heal, payEnergy, spend, remove, overflow, stones } from "../base/model.js";
import { heroAi } from "./registry.js";
import { damageHealing } from "../wave-two/healing.js";
import { heroPolicies as secondWave } from "../wave-two/registry.js";
import { aiFor } from "../base/registry.js";
import { energyUses } from "../base/model.js";
export { draw, heal, payEnergy, spend, remove, overflow, stones };
export { hasActiveEffect } from "../base/model.js";
export const terminal = (state) => Object.values(state.teams).some((t) => t.morale <= 0 || t.cups >= 5);
export const energy = (player) => player.energy.gem + player.energy.crystal;
// Marginal readiness in addition to the energy entities themselves. Only the
// recipient's public state and declared uses are considered, never their hand.
export function energyGiftBonus(state, targetId, { gem = 0, crystal = 0 }) {
  const p=state.players[targetId], profile={...aiFor(p),...secondWave()[p.hero],...heroAi(p.hero)};
  const room=Math.max(0,(p.energyLimit??3)-energy(p));
  gem=Math.min(gem,room);crystal=Math.min(crystal,room-gem);
  const uses=energyUses(state,p), kinds=new Set(uses.map(use=>use.kind));
  const preference=profile.energyPreference ?? (kinds.size===1?(kinds.has('gem')?'gem':'crystal'):
    profile.acceptsCrystalRefinement?.(p,{stones:{gem:0,crystal:1}})===false?'gem':'mixed');
  const ready=energy(p)===0?1:energy(p)===1?.5:.2;
  const allowed=typeof profile.usefulCrystals==='function'
    ?profile.usefulCrystals({state,id:targetId,player:p,action:{stones:{gem,crystal}}}):profile.usefulCrystals??0;
  const blueUse=preference==='gem'?Math.min(crystal,Math.max(0,allowed-p.energy.crystal)):crystal;
  const score=gem*(preference==='gem'&&!p.energy.gem?8:3)*ready+blueUse*4*ready-
    (preference==='gem'?(crystal-blueUse)*6:0);
  return (p.team===state.players[state.observer].team?1:-1)*score;
}
export function publicState(game, id) {
  const state = stateOf(game, id);
  for (const p of state.players) {
    p.heroState = { ...game.player(p.id).hero.state };
    p.coveredCount = game.player(p.id).coveredCount ?? game.player(p.id).covered?.length ?? 0;
    p.healingDisabled = [...game.cards.values()].some(c => c.name === "roseGarden" && c.location.zone === "field");
    p.energyLimit = game.getEnergyLimit(p.id);
  }
  const source = game.player(id);
  state.players[id].hand.push(...playableCards(source).slice(source.hand.length).map(c => ({ ...cardData(c), reserve: true })));
  return state;
}
export function copy(state) {
  const next = clone(state);
  for (const p of next.players) p.heroState = { ...p.heroState };
  return next;
}
export function resourceValue(state) {
  const team = state.players[state.observer].team;
  return state.players.reduce((sum, p) => {
    const score = heroAi(p.hero).resourceValue?.(p) ?? 0;
    return sum + (p.team === team ? score : -score);
  }, 0);
}
export const evaluate = (state) => value(state) + resourceValue(state);
export function discardEstimate(state, id, count) {
  const p = state.players[id], unknown = Math.max(0, p.count - p.hand.length);
  const unknownUsed = Math.min(unknown, count);
  p.count -= unknownUsed;
  const remaining = count - unknownUsed;
  if (remaining) remove(state, id, p.hand.filter(c=>!c.reserve).slice(-remaining));
}
export function applyDamage(state, id, amount, healing, type, moraleLoss = true) {
  const p = state.players[id];
  p.healing -= healing;
  const actual = Math.max(0, amount - healing - (p.hero === "bard" && p.heroState.form === "eternalPrisoner" && type === "spell" ? 1 : 0));
  return applyActualDamage(state, id, actual, type, moraleLoss);
}
export function applyActualDamage(state, id, actual, type, moraleLoss = true) {
  const p = state.players[id], before = Object.fromEntries(Object.entries(state.teams).map(([team, t]) => [team, t.morale]));
  draw(state, id, actual, { spell: moraleLoss && type === "spell", damage: true });
  if (!moraleLoss) for (const [team, morale] of Object.entries(before)) state.teams[team].morale = morale;
  if (terminal(state)) return actual;
  heroAi(p.hero).afterDamage?.({ state, id, player: p, actual, type, moraleLost: Math.max(0,before[p.team]-state.teams[p.team].morale) }, { energy, discardEstimate });
  return actual;
}
export function hurt(state, id, amount, type = "spell", { moraleLoss = true, sourceId = state.observer } = {}) {
  if (terminal(state) || amount <= 0) return 0;
  const p = state.players[id];
  const max = damageHealing(p, amount, type, sourceId);
  let healing = moraleLoss ? Math.min(max, Math.max(0, p.count + amount - p.limit)) : 0;
  if (id === state.observer) {
    let best = -Infinity;
    for (let h = 0; h <= max; h++) {
      const next = copy(state);
      applyDamage(next, id, amount, h, type, moraleLoss);
      const score = evaluate(next);
      if (score > best) { best = score; healing = h; }
    }
  }
  return applyDamage(state, id, amount, healing, type, moraleLoss);
}
export function damageGain(state, id, targetId, amount, type = "spell", options = {}) {
  const next = copy(state); hurt(next, targetId, amount, type, { sourceId: id, ...options });
  return evaluate(next) - evaluate(state);
}
export function lowerHandLimit(state, id, limit) {
  state.players[id].limit = limit;
  overflow(state, id);
}
