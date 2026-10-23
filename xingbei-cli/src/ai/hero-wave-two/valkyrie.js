// Valkyrie decisions consume detached observations only. Form is a next-turn
// option, not a permanent attack ban; all weights are team-utility heuristics.
import { stateOf } from "../v1.5-plans4/model.js";
import { actionPlan, probability } from "../v1.5-plans4/planner.js";
import { cardScore } from "./cards.js";

const energy = (p) => p.energy.gem + p.energy.crystal;
const inForm = (p) => !!p.hero.state?.form;
function loss(p, amount) {
  const guard =
    p.hero.id === "plagueMage"
      ? 0
      : Math.min(amount, p.healing, p.hero.id === "priest" ? 1 : Infinity);
  return Math.max(0, p.hand.length + Math.max(0, amount - guard) - p.handLimit);
}
export function valkyrieHealingValue(g, id, targetId, amount = 1) {
  const p = g.player(targetId);
  if (p.team !== g.player(id).team) return -Infinity;
  const actual = Math.min(
    amount,
    Math.max(0, g.getHealingLimit(targetId) - p.healing),
  );
  if (!actual) return 0;
  const exposed = Math.max(0, Math.min(2, p.hand.length - (p.handLimit - 2)));
  const defensive = p.hero.id === "plagueMage" ? 0 : exposed * 2.25;
  const urgency = g.teams[p.team].morale <= 3 ? 1.5 : 1;
  // Further healing is less urgent once the first incoming attack is covered.
  return Array.from(
    { length: actual },
    (_, i) => (2.5 + defensive / (1 + p.healing + i)) * urgency,
  ).reduce((a, b) => a + b, 0);
}
function bestHealing(g, id, amount) {
  return g.players
    .filter((p) => p.team === g.player(id).team)
    .map((p) => ({
      targetId: p.id,
      value: valkyrieHealingValue(g, id, p.id, amount),
    }))
    .sort((a, b) => b.value - a.value || a.targetId - b.targetId)[0];
}
export function valkyrieFormValue(g, id) {
  // At next turn the fallback is one healing and reset. Stone-funded healing
  // offers flexibility, but is neither free nor guaranteed to remain available.
  return Math.min(
    7,
    Math.max(
      valkyrieHealingValue(g, id, id),
      bestHealing(g, id, 1).value * 0.6,
    ),
  );
}
function summonOption(
  g,
  id,
  targetId,
  amount,
  { ownTurn = g.current === id, alreadyInForm = inForm(g.player(id)) } = {},
) {
  const p = g.player(id),
    target = g.player(targetId);
  if (!energy(p) || target.team === p.team) return { score: 0, use: false };
  const before = loss(target, amount),
    after = loss(target, amount + 1);
  const terminal =
    after >= g.teams[target.team].morale &&
    before < g.teams[target.team].morale;
  const resourceCost = p.energy.crystal ? 3.5 : 6;
  const form = ownTurn && !alreadyInForm ? valkyrieFormValue(g, id) : 0;
  const score =
    30 * (after - before) + form - resourceCost + (terminal ? 10000 : 0);
  return { score, use: score > 0 };
}
export function valkyrieActionAdjustment(
  g,
  id,
  action,
  state = stateOf(g, id),
) {
  const p = g.player(id),
    card = action.type === "play" ? p.hand[action.index] : null;
  if (card?.type !== "attack") return 0;
  const target = g.player(action.targetId);
  const c = state.players[id].hand[action.index];
  const hit = probability(state, id, c, target.id).hit;
  const formCost = inForm(p) ? valkyrieFormValue(g, id) : 0;
  // Active attack resets first. A successful summon can re-enter this same turn.
  const summon = summonOption(g, id, target.id, 2, {
    ownTurn: true,
    alreadyInForm: false,
  });
  return -formCost + hit * Math.max(0, summon.score);
}
function bestNextAttack(g, id, state = stateOf(g, id)) {
  let best = -Infinity;
  const p = g.player(id);
  for (const [index, card] of p.hand.entries())
    if (card.type === "attack") {
      for (const target of g.players)
        if (target.team !== p.team) {
          const action = { type: "play", index, targetId: target.id };
          const base = actionPlan(state, id, action, { sequence: false }).score;
          best = Math.max(
            best,
            base + valkyrieActionAdjustment(g, id, action, state),
          );
        }
    }
  return best;
}
function stoneCost(g, id, gem, crystal) {
  const team = g.player(id).team,
    t = g.stoneCounts(team);
  const synthesisBlocked = t.total >= 3 && t.total - gem - crystal < 3;
  const cupPenalty = synthesisBlocked ? (g.teams[team].cups >= 4 ? 24 : 6) : 0;
  const fullDiscount = t.total >= 5 ? 1.5 : 0;
  return gem * (5 - fullDiscount) + crystal * (3.5 - fullDiscount) + cupPenalty;
}
export function valkyrieRadiancePlan(g, id) {
  const reset = {
    mode: "reset",
    score: valkyrieHealingValue(g, id, id),
    payment: null,
    targetId: id,
  };
  const stones = g.stoneCounts(g.player(id).team),
    options = [reset];
  for (let gem = 0; gem <= Math.min(2, stones.gem); gem++)
    for (
      let crystal = 0;
      crystal <= Math.min(2 - gem, stones.crystal);
      crystal++
    ) {
      if (gem + crystal < 1) continue;
      const heal = bestHealing(g, id, gem + crystal);
      if (heal.value <= 0) continue;
      options.push({
        mode: "stones",
        payment: `${gem}:${crystal}`,
        targetId: heal.targetId,
        score:
          heal.value +
          valkyrieFormValue(g, id) * 0.45 -
          stoneCost(g, id, gem, crystal),
      });
    }
  return options.sort((a, b) => b.score - a.score)[0];
}
export function valkyrieRuleDecision(r, g) {
  const id = r.playerId ?? r.player?.id,
    p = g.player(id),
    context = r.context ?? {};
  if (p.hero.id !== "valkyrie") return undefined;
  if (r.type === "skillChoice" && r.skillId === "heroicSummon") {
    if (context.targetId == null) return false;
    return summonOption(g, id, context.targetId, context.amount ?? 2).use;
  }
  if (r.type === "skillChoice" && r.skillId === "divinePursuit") {
    // Existing attacks are already paid for; never buy a duplicate continuation.
    if (
      (g.turn.state?.pendingActions ?? []).some(
        (a) =>
          a.type === "attack" &&
          (!a.element ||
            p.hand.some(
              (c) =>
                c.type === "attack" &&
                c
                  .getTraits({ game: g, playerId: id })
                  .elements.includes(a.element),
            )),
      )
    )
      return false;
    if (!p.healing) return false;
    const defenseCost = 2.5 + (p.hand.length >= p.handLimit - 1 ? 4 : 0);
    return bestNextAttack(g, id) > defenseCost;
  }
  if (r.type === "numberChoice" && r.skillId === "warGodRadiance") {
    const plan = valkyrieRadiancePlan(g, id);
    if (r.choices.some((c) => c.value === "reset"))
      return r.choices.some((c) => c.value === plan.mode) ? plan.mode : "reset";
    // Already chose the paid branch. Re-evaluate only legal payments, protecting
    // cup resources and preferring the smallest useful payment.
    return (
      [...r.choices].sort((a, b) => {
        const value = (c) => {
          const [gem, crystal] = c.value.split(":").map(Number);
          return (
            bestHealing(g, id, gem + crystal).value -
            stoneCost(g, id, gem, crystal)
          );
        };
        return value(b) - value(a);
      })[0]?.value ?? r.defaultValue
    );
  }
  if (
    r.type === "playerChoice" &&
    ["warGodRadiance", "heroicSummon"].includes(r.skillId)
  ) {
    return (
      [...r.choices].sort(
        (a, b) =>
          valkyrieHealingValue(g, id, b.value) -
          valkyrieHealingValue(g, id, a.value),
      )[0]?.value ?? r.defaultValue
    );
  }
  if (r.type === "cardChoice" && r.skillId === "heroicSummon" && r.optional) {
    const indexes = [...r.valid].sort(
      (a, b) => cardScore(g, id, p.hand[a]) - cardScore(g, id, p.hand[b]),
    );
    const index = indexes[0];
    if (index == null) return null;
    const card = p.hand[index],
      cost = cardScore(g, id, card) / 18;
    // First light is an emergency response option, not cheap healing fodder.
    if (
      card.name === "holyLight" &&
      !p.hand.some((c, i) => i !== index && c.name === "holyLight")
    )
      return null;
    return bestHealing(g, id, 1).value > cost ? [index] : null;
  }
  return undefined;
}
