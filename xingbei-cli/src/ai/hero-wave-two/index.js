import { evaluateMagicAction } from "./magic-value.js";
import {
  planElementalActions,
  elementalActionKey,
  chooseElementalEnhancement,
} from "./elemental-plan.js";
import { radianceHealing } from "./holy-lancer.js";
import { acceptsRefinement, refinementAdjustment } from "./refinement.js";
import {
  valkyrieActionAdjustment,
  valkyrieRuleDecision,
  orderSigilPreference,
} from "./valkyrie.js";
import {
  isolatePolicy,
  captureObservation,
  observationView,
} from "../observation.js";
import { legalActions } from "../../legal-actions.js";
import {
  stateOf,
  clone,
  value,
  spend,
  damage,
  draw,
  heal,
  payEnergy,
  stones,
} from "../v1.5-plans4/model.js";
import {
  actionPlan,
  bestAttack,
  magicBranches,
  expected,
  attackBranches,
} from "../v1.5-plans4/planner.js";
import {
  heroIds,
  cardScore,
  keepCards,
  chooseAiDiscard,
  retentionBonus,
  elements,
} from "./cards.js";
const sumEnergy = (p) => p.energy.gem + p.energy.crystal;
const sign = (g, id, target) =>
  g.player(id).team === g.player(target).team ? 1 : -1;
export function moraleLoss(p, amount, type = "attack") {
  const healing =
    p.hero.id === "plagueMage" && type === "attack"
      ? 0
      : Math.min(p.healing, p.hero.id === "priest" ? 1 : amount);
  return Math.max(
    0,
    p.hand.length + Math.max(0, amount - healing) - p.handLimit,
  );
}
const healingValue = (g, id, target, n = 1) =>
  sign(g, id, target) *
  Math.min(
    n,
    Math.max(0, g.getHealingLimit(target) - g.player(target).healing),
  ) *
  2.5;
const bestHeal = (g, id, n = 1) =>
  Math.max(0, ...g.players.map((p) => healingValue(g, id, p.id, n)));
function continuation(s, id, type) {
  if (type === "attack")
    return Math.max(0, bestAttack(s, id, { depth: 1, sequence: false }).score);
  // One bounded extra spell; no repeated ignition/extra-action recursion.
  let best = 0;
  for (const [index, c] of s.players[id].hand.entries())
    if (c.type === "spell" && c.name !== "holyLight")
      for (const t of s.players) {
        if (c.name === "holyShield" && t.team !== s.players[id].team) continue;
        if (c.name !== "holyShield" && t.team === s.players[id].team) continue;
        if (
          c.name === "holyShield" &&
          t.effects.some((e) => e.name === "holyShield")
        )
          continue;
        best = Math.max(
          best,
          actionPlan(
            s,
            id,
            { type: "play", index, targetId: t.id },
            { sequence: false },
          ).score,
        );
      }
  // Unique attacks can become elemental/saint spells; value having a real follow-up.
  if (
    s.players[id].hand.some((c) =>
      c.uniqueSkills.some(
        (x) =>
          s.players[id].skillIds.includes(x) &&
          [
            "meteor",
            "freeze",
            "fireball",
            "windBlade",
            "lightning",
            "healingArt",
            "healingLight",
          ].includes(x),
      ),
    )
  )
    best = Math.max(best, 3);
  return best;
}
function skillScore(g, id, a, s) {
  const p = g.player(id),
    n = clone(s),
    actor = n.players[id],
    targets = a.targetIds ?? [],
    target = targets[0],
    skill = a.skillId;
  const spec = g.skillActionSpec(id, a),
    costs = (a.cardIds ?? []).map((cid) =>
      actor.hand.find((c) => c.id === cid),
    );
  spend(n, id, costs);
  if (spec.energy) payEnergy(n, id, 1, spec.energy);
  let bonus = 0,
    extra = null;
  const hurt = (t, amount) => damage(n, t, amount, "spell");
  switch (skill) {
    case "healingArt":
      heal(n, target, 2);
      break;
    case "healingLight":
      for (const t of targets) heal(n, t, 1);
      break;
    case "holyCure": {
      for (const t of targets) heal(n, t, 1);
      for (let i = targets.length; i < 3; i++) {
        const t = [...targets].sort(
          (a, b) =>
            sign(g, id, b) *
              Math.max(0, n.players[b].healingLimit - n.players[b].healing) -
            sign(g, id, a) *
              Math.max(0, n.players[a].healingLimit - n.players[a].healing),
        )[0];
        heal(n, t, 1);
      }
      bonus += Math.max(
        continuation(n, id, "attack"),
        continuation(n, id, "spell"),
      );
      break;
    }
    case "radiance":
      if (!radianceHealing(g, id).allowed) return -1e6;
      for (const t of g.players) heal(n, t.id, 1);
      extra = "attack";
      break;
    case "chastisement":
      n.players[target].healing--;
      heal(n, id, 1);
      extra = "attack";
      break;
    case "holyPrayer":
      actor.healing = Math.max(actor.healing, Math.min(5, actor.healing + 2));
      extra = "attack";
      break;
    case "plague":
    case "toxicNova":
      for (const t of g.players)
        if (t.id !== id) hurt(t.id, skill === "plague" ? 1 : 2);
      if (skill === "toxicNova") heal(n, id, 1);
      else if (
        Object.keys(n.teams).some((t) => n.teams[t].morale < s.teams[t].morale)
      )
        heal(n, id, 1);
      break;
    case "deathTouch":
      actor.healing -= spec.healingCost;
      hurt(target, spec.healingCost + costs.length - 3);
      break;
    case "orderSigil":
      draw(n, id, 2);
      heal(n, id, 1);
      if (sumEnergy(actor) < 3) actor.energy.crystal++;
      break;
    case "magicBurst":
      stones(n, p.team, "gem", 1);
      // Opponent spells are hidden: mix discard and damage, never inspect them.
      for (const t of targets) {
        const hit = clone(n);
        damage(hit, t, 2, "spell");
        const refuse = clone(n);
        refuse.players[t].count = Math.max(0, refuse.players[t].count - 1);
        bonus +=
          0.55 * (value(hit) - value(n)) + 0.45 * (value(refuse) - value(n));
      }
      bonus += 3; // modest reliable gem/conversion preference, not unlimited reward
      bonus -= Math.min(actor.count, 2) * 1.5;
      break;
    case "destructionStorm":
      for (const t of targets) hurt(t, 2);
      break;
  }
  if (p.hero.id === "plagueMage" && skill !== "deathTouch") heal(n, id, 1);
  if (extra) bonus += continuation(n, id, extra) * 0.75;
  if (
    p.hero.id === "saint" &&
    costs.some((c) => c.elements.includes("water") || c.name === "holyLight") &&
    ["healingArt", "healingLight"].includes(skill)
  )
    bonus += bestHeal(g, id);
  return (
    value(n) -
    value(s) +
    bonus -
    costs.reduce((v, c) => v + retentionBonus(g, id, g.cards.get(c.id)), 0)
  );
}
function rankAiActions(g, id) {
  const p = g.player(id),
    hero = p.hero.id,
    s = stateOf(g, id);
  const actions = legalActions(g, id).filter((a) => acceptsRefinement(g, id, a)),
    plans = planElementalActions(g, id, actions);
  const ranked = actions
    .map((action) => {
      const magic = evaluateMagicAction(g, id, action, s),
        plan = plans.get(elementalActionKey(action));
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
        if (
          hero === "saint" &&
          (elements(g, id, c).includes("water") || c.name === "holyLight")
        )
          score += bestHeal(g, id);
        if (hero === "plagueMage" && c.type === "spell")
          score += healingValue(g, id, id) + 1;
      }
      if (action.type === "refine")
        score += refinementAdjustment(g, id, action);
      if (hero === "valkyrie") {
        score += valkyrieActionAdjustment(g, id, action, s);
        if (action.skillId === "orderSigil") {
          const pref = orderSigilPreference(g, id);
          score = pref.allowed ? score + pref.bonus : -1e6;
        }
      }
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
  if (hero === "valkyrie") {
    const pref = orderSigilPreference(g, id),
      order = ranked.find((e) => e.action.skillId === "orderSigil");
    // Prioritize free preparation, but do not replace a clearly decisive finish.
    if (pref.priority && order && ranked[0].score < 1000) {
      order.score = Math.max(order.score, ranked[0].score + 1);
      order.explanation.priority = pref.reason;
      order.explanation.score = order.score;
      ranked.sort((a, b) => b.score - a.score);
    }
  }
  return ranked;
}
function chooseAiRuleDecision(r, g) {
  const elemental = chooseElementalEnhancement(
    g,
    r.playerId ?? r.player?.id,
    r,
  );
  if (elemental !== undefined) return elemental;
  const valkyrie = valkyrieRuleDecision(r, g);
  if (valkyrie !== undefined) return valkyrie;
  const id = r.playerId ?? r.player?.id,
    p = g.player(id),
    s = stateOf(g, id),
    ctx = r.context ?? {},
    t = ctx.targetId == null ? null : g.player(ctx.targetId);
  if (r.type === "cardChoice") {
    const indexes = chooseAiDiscard(g, id, r.count, r.valid);
    if (r.optional && r.skillId === "magicBurst") {
      const discard = clone(s),
        hit = clone(s);
      spend(
        discard,
        id,
        indexes.map((i) => s.players[id].hand[i]),
      );
      damage(hit, id, 2, "spell");
      if (
        value(hit) >=
        value(discard) -
          indexes.reduce((n, i) => n + retentionBonus(g, id, p.hand[i]), 0)
      )
        return null;
    }
    return indexes;
  }
  if (r.type === "playerChoice")
    return (
      [...r.choices].sort(
        (a, b) =>
          healingValue(g, id, b.value) - healingValue(g, id, a.value) ||
          g.player(b.value).hand.length - g.player(a.value).hand.length,
      )[0]?.value ?? r.defaultValue
    );
  if (r.type === "healing") {
    const needed = moraleLoss(
      { ...p, healing: 0 },
      ctx.amount ?? 0,
      ctx.damageType,
    );
    return [...r.choices].filter((c) => c.value <= needed).at(-1)?.value ?? 0;
  }
  if (r.type === "numberChoice") {
    if (r.skillId === "earthSpear") {
      if (!t || sign(g, id, t.id) > 0) return 0;
      const base = moraleLoss(t, ctx.amount ?? 2);
      return [...r.choices].sort((a, b) => {
        const score = (c) =>
          30 * (moraleLoss(t, (ctx.amount ?? 2) + c.value) - base) -
          c.value * 3;
        return score(b) - score(a);
      })[0].value;
    }
    if (r.skillId === "holyCure" && r.choices.some((c) => c.value === "spell"))
      return continuation(s, id, "spell") > continuation(s, id, "attack")
        ? "spell"
        : "attack";
    return r.defaultValue;
  }
  if (r.type === "skillChoice") {
    switch (r.skillId) {
      case "elementAbsorption":
      case "immortality":
      case "holyStrike":
        return true;
      case "compassion":
        return (
          !p.hero.state?.compassion && sumEnergy(p) > (r.reservedEnergy ?? 0)
        );
      case "heavenSpear":
        return (
          !!t &&
          t.team !== p.team &&
          t.hand.length >= t.handLimit &&
          !t.getStatus("holyShield").length &&
          moraleLoss(t, ctx.amount ?? 2) > 0
        );
    }
  }
  return r.defaultValue ?? null;
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
