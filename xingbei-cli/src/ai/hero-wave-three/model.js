// Small public-state estimates. They never execute a rule or invent future cards.
import { stateOf, clone, value, draw, heal, payEnergy, spend, remove, overflow, stones } from "../v1.5-plans4/model.js";
export { draw, heal, payEnergy, spend, remove, overflow, stones };
export const terminal = (state) => Object.values(state.teams).some((t) => t.morale <= 0 || t.cups >= 5);
export const energy = (player) => player.energy.gem + player.energy.crystal;
export function publicState(game, id) {
  const state = stateOf(game, id);
  for (const p of state.players) {
    p.heroState = { ...game.player(p.id).hero.state };
    p.energyLimit = game.getEnergyLimit(p.id);
  }
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
    let score = 0;
    const hs = p.heroState ?? {}, e = p.energy;
    if (p.hero === "assassin") score = e.gem * 5 + e.crystal * (e.gem || hs.form ? 2 : 0.5) + (hs.form ? 3 : 0);
    if (p.hero === "magicSwordsman") score = e.gem * 5 + (hs.form ? 3 : 0);
    if (p.hero === "adjudicator") score = e.gem * 3 + e.crystal * 4 + (hs.judgment ?? 0) * 3 + (hs.form ? 3 : 0);
    if (p.hero === "sage") score = Math.min(3, e.gem) * 5 + Math.max(0, e.gem - 3) * 2;
    if (p.hero === "prayer") score = e.gem * 5 + e.crystal * 3 + (hs.prayerRunes ?? 0) * 3 + (hs.form ? 4 : 0);
    if (p.hero === "heroicPuppet") score = e.gem * 4 + e.crystal * 2 + (hs.form ? 3 : 0);
    return sum + (p.team === team ? score : -score);
  }, 0);
}
export const evaluate = (state) => value(state) + resourceValue(state);
export function discardEstimate(state, id, count) {
  const p = state.players[id], unknown = Math.max(0, p.count - p.hand.length);
  const unknownUsed = Math.min(unknown, count);
  p.count -= unknownUsed;
  const remaining = count - unknownUsed;
  if (remaining) remove(state, id, p.hand.slice(-remaining));
}
export function applyDamage(state, id, amount, healing, type, moraleLoss = true) {
  const p = state.players[id], before = Object.fromEntries(Object.entries(state.teams).map(([team, t]) => [team, t.morale]));
  p.healing -= healing;
  const actual = amount - healing;
  draw(state, id, actual, { spell: moraleLoss && type === "spell" });
  if (!moraleLoss) for (const [team, morale] of Object.entries(before)) state.teams[team].morale = morale;
  if (terminal(state)) return actual;
  if (p.hero === "adjudicator" && actual > 0) p.heroState.judgment = Math.min(4, (p.heroState.judgment ?? 0) + 1);
  if (p.hero === "sage" && type === "spell" && actual > 3) {
    p.energy.gem += Math.min(2, Math.max(0, p.energyLimit - energy(p)));
    discardEstimate(state, id, 1);
  }
  return actual;
}
export function hurt(state, id, amount, type = "spell", { moraleLoss = true } = {}) {
  if (terminal(state) || amount <= 0) return 0;
  const p = state.players[id];
  const max = p.hero === "plagueMage" && type === "attack" ? 0 : Math.min(p.healing, p.hero === "priest" ? 1 : amount);
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
export function damageGain(state, id, targetId, amount, type = "spell") {
  const next = copy(state); hurt(next, targetId, amount, type);
  return evaluate(next) - evaluate(state);
}
export function echoGain(state, id, targetId, amount) {
  if (state.players[id].team !== state.players[targetId].team) return -1;
  const next = copy(state); hurt(next, targetId, amount, "spell", { moraleLoss: false });
  return evaluate(next) - evaluate(state);
}
export function lowerHandLimit(state, id, limit) {
  state.players[id].limit = limit;
  overflow(state, id);
}
