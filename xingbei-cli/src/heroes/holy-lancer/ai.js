import { heal } from "../shared/ai/base/model.js";
import { sign } from "../shared/ai/wave-two/value.js";
import { moraleLoss } from "../shared/ai/wave-two/healing.js";

// Presence is public; future healing from these heroes makes Chastisement useful.
const healingHeroes = new Set([
  "guardianAngel",
  "priest",
  "saint",
  "holyLancer",
  "plagueMage",
  "valkyrie",
]);
export function enemyCanHeal(g, id) {
  const team = g.player(id).team;
  return g.players.some(
    (p) =>
      p.team !== team &&
      healingHeroes.has(p.hero.id) &&
      p.hero.skills.length > 0,
  );
}
export function radianceHealing(g, id) {
  const team = g.player(id).team;
  let own = 0,
    enemy = 0;
  for (const p of g.players) {
    const gain = Math.min(1, Math.max(0, g.getHealingLimit(p.id) - p.healing));
    if (p.team === team) own += gain;
    else enemy += gain;
  }
  return { own, enemy, allowed: own >= enemy };
}
function retentionBonus(g, id, card, { elements, same }) {
  const water = elements.includes("water") && radianceHealing(g, id).allowed;
  const spell = card.type === "spell" && enemyCanHeal(g, id);
  return water || spell ? same ? 1.5 : 3 : 0;
}
function scoreSkill({ game: g, id, action, state }) {
  const target = action.targetIds?.[0], actor = state.players[id];
  if (action.skillId === "radiance") {
    if (!radianceHealing(g, id).allowed) return { score: -1e6 };
    for (const player of g.players) heal(state, player.id, 1);
    return { extra: "attack" };
  }
  if (action.skillId === "chastisement") {
    state.players[target].healing--;
    heal(state, id, 1);
    return { extra: "attack" };
  }
  if (action.skillId === "holyPrayer") {
    actor.healing = Math.max(actor.healing, Math.min(5, actor.healing + 2));
    return { extra: "attack" };
  }
  return {};
}
function chooseRuleDecision(request, g) {
  const id = request.playerId ?? request.player?.id, player = g.player(id), context = request.context ?? {};
  const target = context.targetId == null ? null : g.player(context.targetId);
  if (request.type === "numberChoice" && request.skillId === "earthSpear") {
    if (!target || sign(g, id, target.id) > 0) return 0;
    const base = moraleLoss(target, context.amount ?? 2);
    const score = (choice) => 30 * (moraleLoss(target, (context.amount ?? 2) + choice.value) - base) - choice.value * 3;
    return [...request.choices].sort((a, b) => score(b) - score(a))[0].value;
  }
  if (request.type === "skillChoice" && request.skillId === "heavenSpear") {
    return !!target && target.team !== player.team && target.hand.length >= target.handLimit &&
      !target.getStatus("holyShield").length && moraleLoss(target, context.amount ?? 2) > 0;
  }
  if (request.type === "skillChoice" && request.skillId === "holyStrike") return true;
}
export const holyLancerAi = { retentionBonus, scoreSkill, chooseRuleDecision, acceptsCrystalRefinement: () => false };
