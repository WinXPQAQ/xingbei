import { evaluateMagicAction } from "./magic-value.js";
import { acceptsRefinement, refinementAdjustment } from "./refinement.js";
import { heroPolicy, heroIds } from "./registry.js";
import { continuation, healingValue } from "./value.js";
import { moraleLoss } from "./healing.js";
import { magicBurstDiscard } from "../../../magical-girl/ai.js";
import { isolatePolicy, captureObservation, observationView } from "../../../../ai/observation.js";
import { legalActions } from "../../../../legal-actions.js";
import { stateOf, clone, value, spend, damage, payEnergy } from "../base/model.js";
import { actionPlan, magicBranches, expected, attackBranches } from "../base/planner.js";
import { cardScore, keepCards, chooseAiDiscard, retentionBonus } from "./cards.js";
export { moraleLoss } from "./healing.js";

function skillScore(g, id, action, before) {
  const state = clone(before), actor = state.players[id], spec = g.skillActionSpec(id, action);
  const costs = (action.cardIds ?? []).map((cardId) => actor.hand.find((card) => card.id === cardId));
  spend(state, id, costs);
  if (spec.energy) payEnergy(state, id, 1, spec.energy);
  const result = heroPolicy(g, id)?.scoreSkill?.({ game: g, id, action, state, before, costs, spec }) ?? {};
  if (result.score !== undefined) return result.score;
  let bonus = result.bonus ?? 0;
  if (result.extra) bonus += continuation(state, id, result.extra) * 0.75;
  return value(state) - value(before) + bonus - costs.reduce((n, card) => n + retentionBonus(g, id, g.cards.get(card.id)), 0);
}
function rankAiActions(g, id) {
  const p = g.player(id),
    hero = p.hero.id,
    s = stateOf(g, id),
    policy = heroPolicy(g, id);
  const actions = legalActions(g, id).filter((a) => acceptsRefinement(g, id, a)),
    plans = policy?.planActions?.(g, id, actions) ?? new Map();
  const ranked = actions
    .map((action) => {
      const magic = evaluateMagicAction(g, id, action, s),
        plan = plans.get(policy?.actionKey?.(action));
      let score = magic
        ? magic.score
        : plan
          ? plan.score
          : action.type === "skill"
            ? skillScore(g, id, action, s)
            : actionPlan(s, id, action, { sequence: false }).score;
      const c = action.type === "play" ? p.hand[action.index] : null;
      if (c && !magic) {
        score -= retentionBonus(g, id, c);
        score += policy?.playBonus?.(g, id, c) ?? 0;
      }
      if (action.type === "refine")
        score += refinementAdjustment(g, id, action);
      score = policy?.adjustAction?.(g, id, action, s, score) ?? score;
      return {
        action,
        score,
        reason: "hero-wave-two",
        explanation: {
          hero,
          score,
          ...(magic ? { magic: magic.explanation } : {}),
          ...(plan ? { plan: plan.path } : {}),
        },
      };
    })
    .sort((a, b) => b.score - a.score);
  policy?.prioritizeActions?.(g, id, ranked);
  return ranked;
}
function chooseAiRuleDecision(request, g) {
  const id = request.playerId ?? request.player?.id, player = g.player(id), state = stateOf(g, id), context = request.context ?? {};
  const specific = heroPolicy(g, id)?.chooseRuleDecision?.(request, g, state);
  if (specific !== undefined) return specific;
  if (request.type === "cardChoice") {
    const indexes = chooseAiDiscard(g, id, request.count, request.valid);
    return magicBurstDiscard(request, g, state, indexes);
  }
  if (request.type === "playerChoice") return [...request.choices].sort((a, b) =>
    healingValue(g, id, b.value) - healingValue(g, id, a.value) || g.player(b.value).hand.length - g.player(a.value).hand.length,
  )[0]?.value ?? request.defaultValue;
  if (request.type === "healing") {
    const needed = moraleLoss({ ...player, healing: 0 }, context.amount ?? 0, context.damageType);
    return [...request.choices].filter((choice) => choice.value <= needed).at(-1)?.value ?? 0;
  }
  if (request.type === "numberChoice") return request.defaultValue;
  return request.defaultValue ?? null;
}
function chooseAiResponse(g, r) {
  const id = r.target.id,
    s = stateOf(g, id),
    take = clone(s),
    amount = r.damage ?? r.context?.amount ?? 2;
  if (r.shieldable !== false && g.player(id).getStatus("holyShield").length)
    take.players[id].effects = take.players[id].effects.filter(
      (e) => e.name !== "holyShield",
    );
  else damage(take, id, amount, r.attack ? "attack" : "spell");
  let best = { decision: null, score: value(take) };
  for (const e of r.valid) {
    const c = s.players[id].hand[e.index],
      cost = retentionBonus(g, id, e.card);
    let score = -Infinity,
      targetId = null;
    if (r.attack && c.type === "attack")
      for (const t of r.counterTargets) {
        const n =
          expected(
            attackBranches(s, id, c, t.id, { active: false, sequence: false }),
          ) - cost;
        if (n > score) {
          score = n;
          targetId = t.id;
        }
      }
    else {
      const n = clone(s);
      spend(n, id, [c]);
      targetId = r.nextTarget?.id ?? null;
      score =
        c.name === "holyLight"
          ? value(n)
          : expected(magicBranches(n, id, targetId, amount + 1));
      score -= cost;
    }
    if (score > best.score)
      best = { decision: { index: e.index, targetId }, score };
  }
  return best.decision;
}
export function createHeroWaveTwoPolicy(base) {
  const raw = {
    rankAiActions,
    chooseAiRuleDecision,
    chooseAiResponse,
    cardScore,
    keepCards,
    chooseAiDiscard,
    giftScore: (g, id, target, c) => cardScore(g, id, c),
    planWindAttacks: () => null,
  };
  const newHeroes = isolatePolicy(raw, { activation: true });
  const policy = { ...base, acceptsAction: acceptsRefinement };
  for (const name of [
    "rankAiActions",
    "chooseAiDiscard",
    "cardScore",
    "keepCards",
    "giftScore",
  ])
    policy[name] = (g, id, ...args) =>
      (heroIds.has(g.player(id).hero.id) ? newHeroes : base)[name](
        g,
        id,
        ...args,
      );
  // Apply the same active-magic accounting to the original six heroes too.
  // Historical version objects remain frozen; only this preview's routing changes.
  policy.rankAiActions = (g, id) => {
    if (heroIds.has(g.player(id).hero.id))
      return newHeroes.rankAiActions(g, id);
    const entries = base.rankAiActions(g, id)
      .filter((entry) => acceptsRefinement(g, id, entry.action));
    if (
      !entries.some(
        (e) =>
          e.action.type === "play" &&
          g.player(id).hand[e.action.index]?.name === "magicBullet",
      )
    )
      return entries;
    const view = observationView(
        captureObservation(g, id, { actions: true, activation: true }),
      ),
      state = stateOf(view, id);
    return entries
      .map((entry) => {
        const magic = evaluateMagicAction(view, id, entry.action, state);
        return magic
          ? {
              ...entry,
              score: magic.score,
              reason: "active-magic-outcomes",
              explanation: { magic: magic.explanation },
            }
          : entry;
      })
      .sort((a, b) => b.score - a.score);
  };
  policy.chooseAiAction = (g, id) => policy.rankAiActions(g, id)[0].action;
  policy.chooseAiResponse = (g, r) =>
    (heroIds.has(r.target.hero.id) ? newHeroes : base).chooseAiResponse(g, r);
  policy.chooseAiRuleDecision = (r, g) =>
    (g && heroIds.has(g.player(r.playerId ?? r.player?.id).hero.id)
      ? newHeroes
      : base
    ).chooseAiRuleDecision(r, g);
  // A mixed policy is a new version; do not emit a misleading frozen-policy trace.
  delete policy.traceDecision;
  delete policy.replayTrace;
  return policy;
}
