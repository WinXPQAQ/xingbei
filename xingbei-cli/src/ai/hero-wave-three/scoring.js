import { createDeck } from "../../cards.js";
import { legalActions } from "../../legal-actions.js";
import { sameElements, distinctElements, combinations } from "../../card-sets.js";
import { probability, actionPlan } from "../v1.5-plans4/planner.js";
import { evaluateMagicAction } from "../hero-wave-two/magic-value.js";
import { heroIds, acceptsAction, cardCost, chooseAiDiscard } from "./cards.js";
import { publicState, copy, evaluate, terminal, energy, hurt, draw, heal, payEnergy, spend, stones, discardEstimate, lowerHandLimit } from "./model.js";
const printed = createDeck(), lightRate = printed.filter((c) => c.name === "holyLight").length / printed.length;
export const foes = (state, id) => state.players.filter((p) => p.team !== state.players[id].team);
const scoreBranches = (branches) => branches.reduce((sum, b) => sum + b.probability * evaluate(b.state), 0);
const cardObjects = (game, cards) => cards.map((c) => game.cards.get(c.id)).filter(Boolean);

export function runeSetScore(game, id, state, indexes, skillId, targetId, baseAmount = 2) {
  const cards = indexes.map((i) => game.player(id).hand[i]);
  const next = copy(state), p = next.players[id];
  const stateCards = cards.map((c) => p.hand.find((item) => item.id === c.id));
  if (stateCards.some((c) => !c)) return -Infinity;
  spend(next, id, stateCards);
  if (terminal(next)) return evaluate(next) - evaluate(state);
  const extra = cards.length - 1;
  const regular = copy(state);
  if (skillId === "battleRuneStrike") hurt(regular, targetId, baseAmount, "attack");
  if (skillId === "spellRebound") {
    hurt(next, targetId, extra);
    if (!terminal(next)) hurt(next, id, cards.length);
  } else hurt(next, targetId, skillId === "battleRuneStrike" ? baseAmount + extra : extra,
    skillId === "battleRuneStrike" ? "attack" : "spell");
  return evaluate(next) - evaluate(regular) - cardCost(game, id, cards);
}
export function bestRuneSet(game, id, state, skillId, targetId, baseAmount = 2, validSets = null) {
  const hand = game.player(id).hand;
  const predicate = skillId === "magicRuneFusion" ? distinctElements : sameElements;
  const sets = validSets ?? Array.from({ length: Math.max(0, hand.length - 1) }, (_, i) => i + 2)
    .flatMap((count) => combinations(hand.map((_, i) => i), count))
    .filter((indexes) => predicate(game, id, indexes.map((i) => hand[i])));
  let best = { indexes: null, score: 0, targetId };
  for (const indexes of sets) {
    const score = runeSetScore(game, id, state, indexes, skillId, targetId, baseAmount);
    if (score > best.score) best = { indexes, score, targetId };
  }
  return best;
}
function hitModifiers(game, id, state, card, targetId, active) {
  const p = state.players[id];
  let amount = 2;
  if (p.hero === "magicSwordsman" && p.heroState.form) amount++;
  if (active && p.hero === "assassin" && p.heroState.form) amount += energy(p);
  return amount;
}
function attackOutcomes(game, id, state, card, targetId, { active = true, hades = false, alreadyPlayed = false } = {}) {
  const next = copy(state), p = next.players[id];
  const selected = alreadyPlayed ? card : p.hand.find((c) => c.id === card.id);
  if (!selected) return [];
  if (!alreadyPlayed) spend(next, id, [selected]);
  if (terminal(next)) return [{ probability: 1, state: next }];
  if (hades) {
    payEnergy(next, id, 1, "gem");
    next.turn ??= {};
    next.turn.usedSkills ??= {};
    next.turn.usedSkills.hadesTremor = true;
  }
  if (active && p.hero === "prayer" && p.heroState.form)
    p.heroState.prayerRunes = Math.min(3, (p.heroState.prayerRunes ?? 0) + 2);
  const target = next.players[targetId];
  let rates = probability(next, id, selected, targetId);
  if (active && ((p.hero === "assassin" && p.heroState.form) || hades)) {
    const hit = (1 - lightRate) ** target.count;
    const shield = target.effects.some((e) => e.name === "holyShield");
    rates = { hit: shield ? 0 : hit, shield: shield ? hit : 0, light: 1 - hit, counter: 0 };
  }
  if (rates.light > 0 || rates.counter > 0) next.uncertain = true;
  const amount = hitModifiers(game, id, next, card, targetId, active), branches = [];
  if (rates.hit) {
    const hit = copy(next);
    if (hades) { draw(hit, id, Math.max(0, hit.players[id].limit - hit.players[id].count)); discardEstimate(hit, id, 2); }
    const actual = hurt(hit, targetId, amount, "attack");
    if (actual > 0 && target.hero === "assassin" && !terminal(hit)) draw(hit, id, 1);
    if (!terminal(hit)) stones(hit, p.team, active ? "gem" : "crystal", 1);
    let bonus = 0;
    if (active && p.hero === "heroicPuppet" && (p.heroState.battleRunes ?? 0) > 0)
      bonus = bestRuneSet(game, id, next, "battleRuneStrike", targetId, amount).score;
    branches.push({ probability: rates.hit, state: hit, bonus });
  }
  for (const kind of ["light", "shield", "counter"]) {
    if (!rates[kind]) continue;
    const miss = copy(next);
    if (kind === "shield") miss.players[targetId].effects = target.effects.filter((e) => e.name !== "holyShield");
    else miss.players[targetId].count = Math.max(0, target.count - 1);
    let bonus = 0;
    if (active && p.hero === "heroicPuppet") {
      if ((p.heroState.magicRunes ?? 0) > 0) bonus = bestRuneSet(game, id, next, "magicRuneFusion", targetId, 0).score;
      if (!bonus && (p.heroState.battleRunes ?? 0) > 0 && !(p.heroState.magicRunes > 0)) bonus = 1;
    }
    if (kind === "counter") {
      // One public counter horizon, with no inspection of teammate hands.
      let worst = null;
      for (const ally of miss.players.filter((t) => t.team === p.team && t.id !== id)) {
        const hit = copy(miss);
        if (ally.effects.some((e) => e.name === "holyShield"))
          hit.players[ally.id].effects = ally.effects.filter((e) => e.name !== "holyShield");
        else {
          hurt(hit, ally.id, target.hero === "berserker" ? 3 : 2, "attack");
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
  const p = state.players[id], choices = [false];
  if (active && p.hero === "magicSwordsman" && p.energy.gem > 0 && !state.turn?.usedSkills?.hadesTremor) choices.push(true);
  let best = -Infinity;
  for (const hades of choices) {
    const branches = attackOutcomes(game, id, state, card, targetId, { active, hades });
    if (!branches.length) continue;
    let score = scoreBranches(branches) - evaluate(state) - cardCost(game, id, [game.cards.get(card.id)]);
    score += branches.reduce((sum, b) => sum + b.probability * (b.bonus ?? 0), 0);
    if (follow && active && p.hero === "magicSwordsman" && !state.turn?.usedSkills?.asuraCombo) {
      score += branches.reduce((sum, branch) => {
        if (terminal(branch.state)) return sum;
        return sum + branch.probability * Math.max(0, bestAttackScore(game, id, branch.state, { element: "fire" }).score);
      }, 0);
    }
    best = Math.max(best, score);
  }
  return best;
}
export function bestAttackScore(game, id, state, { element = null } = {}) {
  let best = { score: 0, card: null, targetId: null };
  for (const card of state.players[id].hand.filter((c) => c.type === "attack" && (!element || c.elements.includes(element))))
    for (const target of foes(state, id)) {
      if (target.hero === "assassin" && target.heroState.form) continue;
      const score = heroIds.has(state.players[id].hero)
        ? attackScore(game, id, state, card, target.id, { follow: false })
        : actionPlan(state, id, {type:"play",index:state.players[id].hand.indexOf(card),targetId:target.id}, {sequence:false}).score;
      if (score > best.score) best = { score, card: card.id, targetId: target.id };
    }
  return best;
}
function supportTargetBonus(state, id, targetId, skillId) {
  const target = state.players[targetId];
  if (target.team !== state.players[id].team) return -1e6;
  const pressure = Math.min(2, target.count / 3);
  const attacker = ["berserker", "windSwordmaster", "marksman", "magicSwordsman", "heroicPuppet", "valkyrie"].includes(target.hero);
  return (skillId === "powerBlessing" ? 5 : 4) + pressure + (attacker ? 3 : 0);
}
export function skillScore(game, id, state, action) {
  const next = copy(state), p = next.players[id], source = game.player(id);
  const targetId = action.targetIds?.[0], skillId = action.skillId;
  const spec = game.skillActionSpec(id, action), costs = (action.cardIds ?? []).map((cid) => p.hand.find((c) => c.id === cid));
  if (costs.some((c) => !c)) return -1e6;
  if (spec.energy) payEnergy(next, id, 1, spec.energy);
  spend(next, id, costs);
  let extra = 0;
  if (terminal(next)) return evaluate(next) - evaluate(state);
  if (["shadowMeteor", "finalJudgment", "arcaneCodex", "darkCurse"].includes(skillId) && next.players[targetId].team === p.team) return -1e6;
  switch (skillId) {
    case "shadowMeteor":
      if (!p.heroState.form) return -1e6;
      hurt(next, targetId, 2); break;
    case "finalJudgment": {
      const amount = p.heroState.judgment ?? 0;
      p.heroState.judgment = 0; p.heroState.requiredJudgment = false;
      hurt(next, targetId, amount); break;
    }
    case "judgmentBalance":
      p.heroState.judgment = Math.min(4, (p.heroState.judgment ?? 0) + 1);
      if (action.mode === "refill") { draw(next, id, Math.max(0, p.limit - p.count)); stones(next, p.team, "gem", 1); }
      else { p.hand = []; p.count = 0; }
      break;
    case "arcaneCodex":
      hurt(next, targetId, costs.length - 1);
      if (!terminal(next)) hurt(next, id, costs.length - 1);
      break;
    case "holyCodex":
      if (action.targetIds.some((target) => next.players[target].team !== p.team)) return -1e6;
      for (const target of action.targetIds) heal(next, target, 2);
      hurt(next, id, costs.length - 1); break;
    case "radiantFaith": {
      p.heroState.prayerRunes--;
      const discarded = chooseAiDiscard(game, id, Math.min(2, source.hand.length)).map((i) => source.hand[i]);
      spend(next, id, discarded.map((c) => p.hand.find((item) => item.id === c.id)).filter(Boolean), { publicExposure: false });
      extra -= cardCost(game, id, discarded);
      stones(next, p.team, "gem", 1); heal(next, targetId, 1); break;
    }
    case "darkCurse":
      p.heroState.prayerRunes--;
      hurt(next, targetId, 2);
      if (!terminal(next)) hurt(next, id, 2);
      break;
    case "powerBlessing": case "speedBlessing":
      extra += supportTargetBonus(next, id, targetId, skillId); break;
    default: return -1e6;
  }
  return evaluate(next) - evaluate(state) + extra - cardCost(game, id, cardObjects(game, costs));
}
export function preparationOptions(game, id, state, action) {
  const p = state.players[id], card = action.type === "play" ? p.hand[action.index] : null;
  const base = [{ state, activated: null }];
  if (state.turn?.activationDone || !["play", "skill"].includes(action.type)) return base;
  if (p.hero === "magicSwordsman" && !p.heroState.form) {
    const prepared = copy(state); hurt(prepared, id, 1);
    if (!terminal(prepared)) prepared.players[id].heroState.form = "暗影";
    if (action.skillId === "shadowMeteor") return [{ state: prepared, activated: "shadowGathering" }];
    if (card?.type === "attack") base.push({ state: prepared, activated: "shadowGathering" });
  }
  if (card?.type === "attack" && p.hero === "assassin" && !p.heroState.form && p.energy.gem > 0) {
    const prepared = copy(state); payEnergy(prepared, id, 1, "gem");
    prepared.players[id].heroState.form = "潜行";
    lowerHandLimit(prepared, id, p.limit - 1);
    if (prepared.players[id].hand.some((c) => c.id === card.id)) base.push({ state: prepared, activated: "stealth" });
  }
  if (card?.type === "attack" && p.hero === "prayer" && !p.heroState.form && p.energy.gem > 0) {
    const prepared = copy(state); payEnergy(prepared, id, 1, "gem"); prepared.players[id].heroState.form = "prayer";
    base.push({ state: prepared, activated: "prayer" });
  }
  if (card?.type === "attack" && p.hero === "heroicPuppet" && !p.heroState.form && p.energy.gem > 0 && p.hand.length >= 3) {
    const prepared = copy(state); payEnergy(prepared, id, 1, "gem");
    prepared.players[id].heroState.form = "runeBurst"; prepared.players[id].limit++;
    draw(prepared, id, 1);
    base.push({ state: prepared, activated: "runeReconstruction" });
  }
  return base;
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
    if (gem && !p.energy.gem) score += ["sage", "magicSwordsman", "assassin", "prayer", "heroicPuppet"].includes(p.hero) ? 8 : 3;
    if (p.hero === "prayer" && crystal && !p.energy.crystal && p.heroState.prayerRunes > 0) score += 2;
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
  if (p.hero === "prayer") {
    for (const card of p.hand) for (const skillId of ["powerBlessing", "speedBlessing"])
      if (card.uniqueSkills.includes(skillId)) for (const target of state.players.filter((t) => t.team === p.team && t.id !== id && !t.effects.some((e) => e.name === skillId)))
        actions.push({ type: "skill", skillId, cardIds: [card.id], targetIds: [target.id] });
    if (p.heroState.form && p.heroState.prayerRunes > 0) {
      for (const target of foes(state, id)) actions.push({ type: "skill", skillId: "darkCurse", cardIds: [], targetIds: [target.id] });
      for (const target of state.players.filter((t) => t.team === p.team && t.id !== id)) actions.push({ type: "skill", skillId: "radiantFaith", cardIds: [], targetIds: [target.id] });
    }
  }
  let best = 0;
  for (const action of actions) {
    // A decision observation intentionally has no callable live skill catalogue.
    // Prayer's four resource-free spell actions need no dynamic energy spec.
    const proxy = action.type === "skill" ? { ...game, skillActionSpec: () => ({}) } : game;
    best = Math.max(best, rawActionScore(proxy, id, state, action));
  }
  return best;
}
export function chooseHades(game, id, state, card, targetId) {
  const before = attackOutcomes(game, id, state, card, targetId, { active: true, alreadyPlayed: true });
  const after = attackOutcomes(game, id, state, card, targetId, { active: true, hades: true, alreadyPlayed: true });
  return after.length && before.length && scoreBranches(after) > scoreBranches(before) + 0.5;
}
