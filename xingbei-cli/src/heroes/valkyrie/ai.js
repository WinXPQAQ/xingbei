// Valkyrie decisions consume detached observations only. Form is a next-turn
// option, not a permanent attack ban; all weights are team-utility heuristics.
import { stateOf, draw, heal } from "../shared/ai/base/model.js";
import { actionPlan, probability } from "../shared/ai/base/planner.js";
import { cardScore } from "../shared/ai/wave-two/cards.js";

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
// Sigil draws before granting healing/energy, so overflow cannot be paid for
// by the healing this action will generate. "Stones" here means personal energy.
export function orderSigilPreference(g, id) {
  const p = g.player(id),
    space = p.handLimit - p.hand.length;
  const count = energy(p),
    healingFull = p.healing >= g.getHealingLimit(id);
  const morale = g.teams[p.team].morale,
    overflow = Math.max(0, 2 - space);
  const result = (allowed, priority, bonus, reason) => ({
    allowed,
    priority,
    bonus,
    reason,
  });
  if (space < 2) {
    if (morale < 8 || morale - overflow < 6)
      return result(false, false, 0, "unsafe-overflow");
    if (p.healing === 0 && count === 0)
      return result(true, false, 18, "empty-resources-safe-overflow");
    return result(false, false, 0, "overflow-with-existing-resources");
  }
  if (!healingFull && count < 3)
    return result(true, true, 0, "safe-healing-and-energy");
  if (healingFull)
    return count === 0
      ? result(true, false, 8, "prepare-first-energy")
      : result(false, false, 0, "healing-full-with-energy");
  if (count >= 3 && p.healing === 0) {
    const weak = p.hand.filter(
      (card) =>
        cardScore(
          g,
          id,
          card,
          p.hand.filter((other) => other.id !== card.id),
        ) < 60,
    ).length;
    const poorHand =
      p.hand.length <= 2 || weak >= Math.max(2, Math.ceil(p.hand.length / 2));
    return result(
      poorHand,
      false,
      poorHand ? 5 : 0,
      poorHand ? "refill-poor-hand" : "keep-good-hand",
    );
  }
  return result(false, false, 0, "resources-already-sufficient");
}
function summonHealingTarget(g, id, candidates = g.players.map((p) => p.id)) {
  const actor = g.player(id);
  const useful = candidates.filter((targetId) => {
    const target = g.player(targetId);
    return (
      target.team === actor.team && target.healing < g.getHealingLimit(targetId)
    );
  });
  // Own healing is replenished by next-turn radiance and sigil. Spend the
  // optional discard on a teammate whenever any teammate can actually heal.
  const teammates = useful.filter((targetId) => targetId !== id);
  const targets = teammates.length ? teammates : useful;
  return (
    targets
      .map((targetId) => ({
        targetId,
        value: valkyrieHealingValue(g, id, targetId),
      }))
      .sort((a, b) => b.value - a.value || a.targetId - b.targetId)[0] ?? {
      targetId: candidates.includes(id) ? id : candidates[0],
      value: 0,
    }
  );
}
function summonHealingOption(g, id) {
  const p = g.player(id),
    recipient = summonHealingTarget(g, id);
  if (!recipient.value) return { cardIndex: null, score: 0 };
  const candidates = p.hand
    .flatMap((card, index) => {
      if (card.type !== "spell") return [];
      if (
        card.name === "holyLight" &&
        !p.hand.some((c, i) => i !== index && c.name === "holyLight")
      )
        return [];
      const cost =
        cardScore(
          g,
          id,
          card,
          p.hand.filter((c) => c.id !== card.id),
        ) / 30;
      return [{ cardIndex: index, score: recipient.value - cost }];
    })
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.score > 0
    ? candidates[0]
    : { cardIndex: null, score: 0 };
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
    30 * (after - before) +
    form +
    summonHealingOption(g, id).score -
    resourceCost +
    (terminal ? 10000 : 0);
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
    if (r.skillId === "heroicSummon")
      return (
        summonHealingTarget(
          g,
          id,
          r.choices.map((choice) => choice.value),
        ).targetId ?? r.defaultValue
      );
    return (
      [...r.choices].sort(
        (a, b) =>
          valkyrieHealingValue(g, id, b.value) -
          valkyrieHealingValue(g, id, a.value),
      )[0]?.value ?? r.defaultValue
    );
  }
  if (r.type === "cardChoice" && r.skillId === "heroicSummon" && r.optional) {
    const option = summonHealingOption(g, id);
    return option.cardIndex != null && r.valid.includes(option.cardIndex)
      ? [option.cardIndex]
      : null;
  }
  return undefined;
}
function scoreSkill({ id, action, state }) {
  if (action.skillId === "orderSigil") {
    draw(state, id, 2);
    heal(state, id, 1);
    if (energy(state.players[id]) < 3) state.players[id].energy.crystal++;
  }
  return {};
}
function adjustAction(g, id, action, state, score) {
  score += valkyrieActionAdjustment(g, id, action, state);
  if (action.skillId === "orderSigil") {
    const preference = orderSigilPreference(g, id);
    score = preference.allowed ? score + preference.bonus : -1e6;
  }
  return score;
}
function prioritizeActions(g, id, ranked) {
  const preference = orderSigilPreference(g, id), order = ranked.find((entry) => entry.action.skillId === "orderSigil");
  // Prepare for free unless another action is a clearly decisive finish.
  if (preference.priority && order && ranked[0].score < 1000) {
    order.score = Math.max(order.score, ranked[0].score + 1);
    order.explanation.priority = preference.reason;
    order.explanation.score = order.score;
    ranked.sort((a, b) => b.score - a.score);
  }
}
export const valkyrieAi = {
  retentionBonus: (g, id, card) => card.type === "spell" ? 2 : 0,
  scoreSkill, adjustAction, prioritizeActions, chooseRuleDecision: valkyrieRuleDecision,
};
