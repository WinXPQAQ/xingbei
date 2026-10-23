import { createDeck } from "../../../../cards.js";
import { legalActions } from "../../../../legal-actions.js";
import { combinations } from "../../../../card-sets.js";
import { probability, actionPlan } from "../base/planner.js";
import { evaluateMagicAction } from "../wave-two/magic-value.js";
import { heroIds, acceptsAction, cardCost } from "./cards.js";
import { publicState, copy, evaluate, terminal, hurt, payEnergy, spend, stones } from "./model.js";
import { aiFor } from "../base/registry.js";
import * as model from "./model.js";
import * as cards from "./cards.js";
import { heroAi } from "./registry.js";
const printed = createDeck(), lightRate = printed.filter((c) => c.name === "holyLight").length / printed.length;
export const foes = (state, id) => state.players.filter((p) => p.team !== state.players[id].team);
export const scoreBranches = (branches) => branches.reduce((sum, b) => sum + b.probability * evaluate(b.state), 0);
const cardObjects = (game, cards) => cards.map((c) => game.cards.get(c.id)).filter(Boolean);

// Enumerate legal public card combinations; the owning hero scores their effects.
export function bestCardSet(game, id, targetId, validSets, predicate, scoreSet) {
  const hand = game.player(id).hand;
  const sets = validSets ?? Array.from({ length: Math.max(0, hand.length - 1) }, (_, i) => i + 2)
    .flatMap((count) => combinations(hand.map((_, i) => i), count))
    .filter((indexes) => predicate(game, id, indexes.map((i) => hand[i])));
  let best = { indexes: null, score: 0, targetId };
  for (const indexes of sets) {
    const score = scoreSet(indexes);
    if (score > best.score) best = { indexes, score, targetId };
  }
  return best;
}
export function attackOutcomes(game, id, state, card, targetId, { active = true, variant = false, alreadyPlayed = false } = {}) {
  const next = copy(state), p = next.players[id];
  const selected = alreadyPlayed ? card : p.hand.find((c) => c.id === card.id);
  if (!selected) return [];
  if (!alreadyPlayed) spend(next, id, [selected]);
  if (terminal(next)) return [{ probability: 1, state: next }];
  const profile = heroAi(p.hero);
  profile.prepareAttack?.({ state: next, id, player: p, active, variant }, scoringApi);
  const target = next.players[targetId];
  let rates = probability(next, id, selected, targetId);
  if (profile.uncounterable?.({ player: p, active, variant })) {
    const hit = (1 - lightRate) ** target.count;
    const shield = target.effects.some((e) => e.name === "holyShield");
    rates = { hit: shield ? 0 : hit, shield: shield ? hit : 0, light: 1 - hit, counter: 0 };
  }
  if (rates.light > 0 || rates.counter > 0) next.uncertain = true;
  const amount = 2 + (profile.attackDamage?.({ player: p, active }, scoringApi) ?? 0), branches = [];
  if (rates.hit) {
    const hit = copy(next);
    profile.beforeAttackHit?.({ state: hit, id, variant }, scoringApi);
    const actual = hurt(hit, targetId, amount, "attack");
    heroAi(target.hero).afterAttackDamage?.({ state: hit, actorId: id, actual }, scoringApi);
    if (!terminal(hit)) stones(hit, p.team, active ? "gem" : "crystal", 1);
    const bonus = profile.attackHitBonus?.({ game, id, state: next, player: p, active, targetId, amount }, scoringApi) ?? 0;
    branches.push({ probability: rates.hit, state: hit, bonus });
  }
  for (const kind of ["light", "shield", "counter"]) {
    if (!rates[kind]) continue;
    const miss = copy(next);
    if (kind === "shield") miss.players[targetId].effects = target.effects.filter((e) => e.name !== "holyShield");
    else miss.players[targetId].count = Math.max(0, target.count - 1);
    const bonus = profile.attackMissBonus?.({ game, id, state: next, player: p, active, targetId }, scoringApi) ?? 0;
    if (kind === "counter") {
      // One public counter horizon, with no inspection of teammate hands.
      let worst = null;
      for (const ally of miss.players.filter((t) => t.team === p.team && t.id !== id)) {
        const hit = copy(miss);
        if (ally.effects.some((e) => e.name === "holyShield"))
          hit.players[ally.id].effects = ally.effects.filter((e) => e.name !== "holyShield");
        else {
          hurt(hit, ally.id, aiFor(target).estimatedCounterDamage ?? 2, "attack");
          if (!terminal(hit)) stones(hit, target.team, "crystal", 1);
        }
        const chance = 0.75 ** ally.count, score = chance * evaluate(hit) + (1 - chance) * evaluate(miss);
        if (!worst || score < worst.score) worst = { score, chance, hit };
      }
      if (worst) {
        branches.push({ probability: rates.counter * worst.chance, state: worst.hit, bonus });
        branches.push({ probability: rates.counter * (1 - worst.chance), state: miss, bonus });
        continue;
      }
    }
    branches.push({ probability: rates[kind], state: miss, bonus });
  }
  return branches;
}
export function attackScore(game, id, state, card, targetId, { active = true, follow = true } = {}) {
  const p = state.players[id], profile = heroAi(p.hero);
  const choices = profile.attackVariants?.({ player: p, state, active }) ?? [false];
  let best = -Infinity;
  for (const variant of choices) {
    const branches = attackOutcomes(game, id, state, card, targetId, { active, variant });
    if (!branches.length) continue;
    let score = scoreBranches(branches) - evaluate(state) - cardCost(game, id, [game.cards.get(card.id)]);
    score += branches.reduce((sum, b) => sum + b.probability * (b.bonus ?? 0), 0);
    if (follow) score += profile.followAttackScore?.({ game, id, state, active, branches }, scoringApi) ?? 0;
    best = Math.max(best, score);
  }
  return best;
}
export function bestAttackScore(game, id, state, { element = null } = {}) {
  let best = { score: 0, card: null, targetId: null };
  for (const card of state.players[id].hand.filter((c) => c.type === "attack" && (!element || c.elements.includes(element))))
    for (const target of foes(state, id)) {
      if (heroAi(target.hero).blocksActiveAttack?.(target)) continue;
      const score = heroIds.has(state.players[id].hero)
        ? attackScore(game, id, state, card, target.id, { follow: false })
        : actionPlan(state, id, {type:"play",index:state.players[id].hand.indexOf(card),targetId:target.id}, {sequence:false}).score;
      if (score > best.score) best = { score, card: card.id, targetId: target.id };
    }
  return best;
}
export function skillScore(game, id, state, action) {
  const next = copy(state), p = next.players[id], source = game.player(id);
  const targetId = action.targetIds?.[0], skillId = action.skillId;
  const spec = game.skillActionSpec(id, action), costs = (action.cardIds ?? []).map((cid) => p.hand.find((c) => c.id === cid));
  if (costs.some((c) => !c)) return -1e6;
  if (spec.energy) payEnergy(next, id, 1, spec.energy);
  spend(next, id, costs);
  if (terminal(next)) return evaluate(next) - evaluate(state);
  const extra = heroAi(p.hero).scoreSkill?.({ game, next, id, source, player: p, action, costs, targetId, skillId }, scoringApi);
  if (extra == null) return -1e6;
  return evaluate(next) - evaluate(state) + extra - cardCost(game, id, cardObjects(game, costs));
}
export function preparationOptions(game, id, state, action) {
  const p = state.players[id], card = action.type === "play" ? p.hand[action.index] : null;
  const base = [{ state, activated: null }];
  if (state.turn?.activationDone || !["play", "skill"].includes(action.type)) return base;
  return heroAi(p.hero).preparations?.({ state, id, player: p, card, action, options: base }, scoringApi) ?? base;
}

function rawActionScore(game, id, state, action) {
  if (terminal(state)) return 0;
  if (action.type === "skill") return skillScore(game, id, state, action);
  const card = action.type === "play" ? game.player(id).hand[action.index] : null;
  if (card?.type === "attack") return attackScore(game, id, state, card, action.targetId);
  const magic = evaluateMagicAction(game, id, action, state);
  if (magic) return magic.score;
  const plan = actionPlan(state, id, action, { sequence: false });
  let score = scoreBranches(plan.branches) - evaluate(state);
  if (card) score -= cardCost(game, id, [card]);
  if (action.type === "refine") {
    const p = state.players[id], { gem, crystal } = action.stones;
    score += heroAi(p.hero).refineBonus?.({ player: p, gem, crystal }) ?? 0;
    const team = state.teams[p.team];
    if (team.cups === 4 && team.gem + team.crystal >= 3 && team.gem + team.crystal - gem - crystal < 3) score -= 40;
  }
  return score;
}
export function rankAiActions(game, id) {
  const state = publicState(game, id), before = evaluate(state);
  return legalActions(game, id).filter((action) => acceptsAction(game, id, action)).map((action) => {
    let best = { score: -Infinity, activated: null };
    for (const prepared of preparationOptions(game, id, state, action)) {
      const score = evaluate(prepared.state) - before + rawActionScore(game, id, prepared.state, action);
      if (score > best.score) best = { score, activated: prepared.activated };
    }
    return { action, score: best.score, reason: "hero-wave-three", explanation: { hero: game.player(id).hero.id, activation: best.activated } };
  }).sort((a, b) => b.score - a.score);
}
export function bestSpellFollow(game, id, state) {
  const p = state.players[id], current = game.player(id), actions = [];
  for (const card of p.hand.filter((c) => c.type === "spell" && c.name !== "holyLight")) {
    const index = current.hand.findIndex((c) => c.id === card.id);
    if (index < 0) continue;
    let targets = card.name === "holyShield" ? state.players.filter((t) => t.team === p.team && !t.effects.some((e) => e.name === "holyShield")) : foes(state, id);
    if (card.name === "weakness") targets = targets.filter((t)=>!t.effects.some((e)=>e.name==="weakness"));
    if (card.name === "magicBullet") targets = [foes(state, id).sort((a,b) => ((a.id-id+6)%6)-((b.id-id+6)%6))[0]];
    for (const target of targets) actions.push({ type: "play", index, targetId: target.id });
  }
  actions.push(...(heroAi(p.hero).spellActions?.({ state, id, player: p }, scoringApi) ?? []));
  let best = 0;
  for (const action of actions) {
    // Follow-up hooks provide resource-free skill candidates from the observation.
    // A decision observation has no callable live skill catalogue.
    const proxy = action.type === "skill" ? { ...game, skillActionSpec: () => ({}) } : game;
    best = Math.max(best, rawActionScore(proxy, id, state, action));
  }
  return best;
}
export const scoringApi = {
  ...model, ...cards, foes, scoreBranches, bestCardSet, attackOutcomes,
  attackScore, bestAttackScore, bestSpellFollow, preparationOptions,
};
