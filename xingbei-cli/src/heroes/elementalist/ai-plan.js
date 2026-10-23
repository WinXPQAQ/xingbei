// Bounded, public-information planning for one elemental spell-action chain.
// Never mutate Game or invent usable cards from future draws.
import {
  stateOf,
  clone,
  value,
  spend,
  damage,
  heal,
  payEnergy,
  stones,
  traits,
} from "../shared/ai/base/model.js";
import { bestAttack } from "../shared/ai/base/planner.js";
import { elementalSkills, enhancementCard } from "./ai-enhancement.js";
import { retentionBonus } from "../shared/ai/wave-two/cards.js";

const MAX_ACTIONS = 5;
const MAX_NODES = 96;
const BEAM = 8;
const DIRECT = new Set([
  ...Object.keys(elementalSkills),
  "elementIgnition",
  "moonlight",
]);
const CHAIN = new Set(["meteor", "elementIgnition"]);
export const elementalActionKey = (a) =>
  JSON.stringify([a.type, a.skillId, a.cardIds ?? [], a.targetIds ?? []]);
const energy = (p) => p.energy.gem + p.energy.crystal;
const terminal = (s) =>
  Object.values(s.teams).some((t) => t.morale <= 0 || t.cups >= 5);
const wins = (s, id) => {
  const own = s.players[id].team,
    enemy = own === "red" ? "blue" : "red";
  return (
    s.teams[own].morale > 0 &&
    (s.teams[enemy].morale <= 0 || s.teams[own].cups >= 5)
  );
};
const stop = () => ({ score: 0, damage: 0, path: [] });

function cardOptions(g, id, state, skillId, targetId) {
  const candidates = state.players[id].hand
    .filter((c) => traits(c, id).includes(elementalSkills[skillId]));
  const preferred = enhancementCard(g, id, skillId, targetId,
    candidates.map((c) => g.cards.get(c.id)).filter(Boolean), { state });
  // Paying an exposed cost can trigger a seal before our damage. Always compare
  // declining the optional payment, including for non-chain spells.
  return preferred ? [preferred.id, null] : [null];
}
function healingBonus(state, id) {
  let best = 0,
    chosen = null;
  for (const target of state.players.filter(
    (p) => p.team === state.players[id].team,
  )) {
    const next = clone(state);
    heal(next, target.id, 1);
    const gain = value(next) - value(state);
    if (gain > best) {
      best = gain;
      chosen = target.id;
    }
  }
  if (chosen != null) heal(state, chosen, 1);
}
function step(
  g,
  id,
  state,
  elements,
  action,
  boostCardId,
  { alreadyPlayed = false } = {},
) {
  const next = clone(state),
    actor = next.players[id],
    skill = action.skillId,
    target = action.targetIds[0];
  let spent = 0,
    newElements = elements;
  if (!alreadyPlayed && action.cardIds?.length) {
    const card = actor.hand.find((c) => c.id === action.cardIds[0]);
    if (!card) return null;
    spent += retentionBonus(g, id, g.cards.get(card.id));
    spend(next, id, [card]);
  }
  if (terminal(next))
    return {
      state: next,
      elements: newElements,
      damage: 0,
      cost: spent,
      action,
      boostCardId: null,
    };
  let amount = skill === "fireball" || skill === "elementIgnition" ? 2 : 1;
  if (boostCardId != null) {
    const card = actor.hand.find((c) => c.id === boostCardId);
    if (!card || !traits(card, id).includes(elementalSkills[skill]))
      return null;
    spent += retentionBonus(g, id, g.cards.get(card.id));
    spend(next, id, [card]);
    amount++;
  }
  if (terminal(next))
    return {
      state: next,
      elements: newElements,
      damage: 0,
      cost: spent,
      action,
      boostCardId,
    };
  if (skill === "elementIgnition") {
    if (newElements < 3) return null;
    newElements -= 3;
  } else if (skill === "moonlight") {
    if (actor.energy.gem < 1) return null;
    payEnergy(next, id, 1, "gem");
    amount = 1 + energy(actor);
  }
  if (skill !== "elementIgnition") newElements = Math.min(3, newElements + 1);
  damage(next, target, amount, "spell");
  if (!terminal(next)) {
    if (skill === "freeze") healingBonus(next, id);
    if (skill === "lightning") stones(next, actor.team, "gem", 1);
  }
  return {
    state: next,
    elements: newElements,
    damage: amount,
    cost: spent,
    action,
    boostCardId,
  };
}
function actionsFor(state, id, elements) {
  const p = state.players[id],
    targets = state.players.filter((t) => t.team !== p.team).map((t) => t.id),
    skills = [];
  // Equivalent printed copies need not multiply a future search; their IDs still
  // remain in hand and a used/cost card is physically removed from every branch.
  const seen = new Set();
  for (const c of p.hand)
    for (const skillId of c.uniqueSkills) {
      if (
        !Object.hasOwn(elementalSkills, skillId) ||
        !p.skillIds.includes(skillId)
      )
        continue;
      const key = skillId + ":" + traits(c, id).join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      skills.push({ skillId, cardIds: [c.id] });
    }
  if (elements >= 3) skills.push({ skillId: "elementIgnition", cardIds: [] });
  if (p.energy.gem > 0) skills.push({ skillId: "moonlight", cardIds: [] });
  return skills.flatMap((a) =>
    targets.map((targetId) => ({ type: "skill", ...a, targetIds: [targetId] })),
  );
}
function memoKey(state, id, elements, depth) {
  return JSON.stringify([
    elements,
    depth,
    state.players[id].hand.map((c) => c.id),
    state.players.map((p) => [
      p.count,
      p.healing,
      p.energy.gem,
      p.energy.crystal,
      p.effects.map((e) => e.id),
    ]),
    state.teams,
  ]);
}
function search(g, id, state, elements, depth, budget, memo) {
  if (depth <= 0 || terminal(state) || budget.left <= 0) return stop();
  const key = memoKey(state, id, elements, depth);
  if (memo.has(key)) return memo.get(key);
  budget.left--;
  const before = value(state),
    rows = [];
  for (const action of actionsFor(state, id, elements)) {
    const paid = clone(state);
    if (action.cardIds.length)
      spend(paid, id, [
        paid.players[id].hand.find((c) => c.id === action.cardIds[0]),
      ]);
    const boosts = Object.hasOwn(elementalSkills, action.skillId)
      ? cardOptions(g, id, paid, action.skillId, action.targetIds[0])
      : [null];
    for (const boost of boosts) {
      const next = step(g, id, state, elements, action, boost);
      if (!next) continue;
      const immediate =
        value(next.state) -
        before +
        1.5 * (next.elements - elements) -
        next.cost;
      const pressure = next.damage * 0.5 + (CHAIN.has(action.skillId) ? 4 : 0);
      rows.push({ next, immediate, order: immediate + pressure });
    }
  }
  // Direct finishers are cheap to compare; only spell-action grants recurse.
  let best = stop();
  const chained = rows
    .filter((r) => CHAIN.has(r.next.action.skillId))
    .sort((a, b) => b.order - a.order)
    .slice(0, BEAM);
  for (const row of [
    ...rows.filter((r) => !CHAIN.has(r.next.action.skillId)),
    ...chained,
  ]) {
    const { next } = row;
    let follow = stop();
    if (CHAIN.has(next.action.skillId) && !terminal(next.state)) {
      follow = search(
        g,
        id,
        next.state,
        next.elements,
        depth - 1,
        budget,
        memo,
      );
      if (follow.damage <= 0 || follow.score <= 0.5) continue;
    }
    let score = row.immediate + follow.score;
    if (next.action.skillId === "windBlade" && !terminal(next.state))
      score +=
        Math.max(
          0,
          bestAttack(next.state, id, { depth: 1, sequence: false }).score,
        ) * 0.75;
    if (score > best.score)
      best = {
        score,
        damage: next.damage + follow.damage,
        path: [
          {
            ...next.action,
            boostCardId: next.boostCardId,
            damage: next.damage,
            elementsAfter: next.elements,
          },
          ...follow.path,
        ],
      };
  }
  memo.set(key, best);
  return best;
}
function rootPlan(
  g,
  id,
  state,
  elements,
  action,
  { alreadyPlayed = false } = {},
) {
  const paid = clone(state);
  if (!alreadyPlayed && action.cardIds?.length) {
    const c = paid.players[id].hand.find((c) => c.id === action.cardIds[0]);
    if (!c) return null;
    spend(paid, id, [c]);
  }
  const boosts = Object.hasOwn(elementalSkills, action.skillId)
    ? cardOptions(g, id, paid, action.skillId, action.targetIds[0])
    : [null];
  const before = value(state),
    memo = new Map();
  let best = null;
  for (const boost of boosts) {
    const next = step(g, id, state, elements, action, boost, { alreadyPlayed });
    if (!next) continue;
    let follow = stop();
    if (CHAIN.has(action.skillId) && !terminal(next.state))
      follow = search(
        g,
        id,
        next.state,
        next.elements,
        MAX_ACTIONS - 1,
        { left: MAX_NODES },
        memo,
      );
    const allowed =
      !CHAIN.has(action.skillId) ||
      wins(next.state, id) ||
      (follow.damage > 0 && follow.score > 0.5);
    let score =
      value(next.state) -
      before +
      1.5 * (next.elements - elements) -
      next.cost +
      follow.score;
    if (action.skillId === "windBlade" && !terminal(next.state))
      score +=
        Math.max(
          0,
          bestAttack(next.state, id, { depth: 1, sequence: false }).score,
        ) * 0.75;
    const row = {
      allowed,
      score: allowed ? score : -1e6,
      damage: next.damage + follow.damage,
      boostCardId: boost,
      path: [
        {
          ...action,
          boostCardId: boost,
          damage: next.damage,
          elementsAfter: next.elements,
        },
        ...follow.path,
      ],
    };
    if (!best || row.score > best.score) best = row;
  }
  return best;
}
export function planElementalActions(g, id, actions) {
  const result = new Map();
  if (g.player(id).hero.id !== "elementalist") return result;
  const state = stateOf(g, id),
    elements = g.player(id).hero.state?.elements ?? 0;
  for (const action of actions) {
    if (action.type !== "skill" || !DIRECT.has(action.skillId)) continue;
    if (g.player(action.targetIds[0]).team === g.player(id).team) {
      result.set(elementalActionKey(action), {
        allowed: false,
        score: -1e6,
        path: [],
        damage: 0,
        boostCardId: null,
      });
      continue;
    }
    const plan = rootPlan(g, id, state, elements, action);
    if (plan) result.set(elementalActionKey(action), plan);
  }
  return result;
}
export function chooseElementalEnhancement(g, id, request) {
  if (
    g.player(id).hero.id !== "elementalist" ||
    request.type !== "cardChoice" ||
    !request.optional ||
    !Object.hasOwn(elementalSkills, request.skillId)
  )
    return undefined;
  const targetId = request.context?.targetId;
  if (targetId == null || g.player(targetId).team === g.player(id).team)
    return null;
  // The initial unique card is already on field at this checkpoint. Do not pay
  // for it again or award its element before the damage point actually occurs.
  const state = stateOf(g, id),
    elements = g.player(id).hero.state?.elements ?? 0;
  const plan = rootPlan(
    g,
    id,
    state,
    elements,
    {
      type: "skill",
      skillId: request.skillId,
      cardIds: [],
      targetIds: [targetId],
    },
    { alreadyPlayed: true },
  );
  if (plan?.boostCardId == null) return null;
  const index = g.player(id).hand.findIndex((c) => c.id === plan.boostCardId);
  return request.valid.includes(index) ? [index] : null;
}
