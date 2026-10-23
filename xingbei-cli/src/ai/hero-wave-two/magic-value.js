// Active magic is evaluated by consequences of this relay, not by the general
// hand-burden/next-turn-risk potential. A non-overflow draw is not morale damage.
import { createDeck } from "../../cards.js";
import { stateOf, clone, spend, payEnergy } from "../v1.5-plans4/model.js";
import { bestAttack } from "../v1.5-plans4/planner.js";
import { cardScore } from "./cards.js";

const printed = createDeck();
const lightRate =
  printed.filter((c) => c.name === "holyLight").length / printed.length;
const relayRate =
  printed.filter((c) => c.name === "magicBullet").length / printed.length;
const fusionRate =
  printed.filter(
    (c) =>
      c.name === "magicBullet" ||
      c.elements.some((e) => e === "fire" || e === "earth"),
  ).length / printed.length;
const MAX_RELAY_TARGETS = 6;
const hasSkill = (p, id) => p.skillIds.includes(id);
const terminal = (s) =>
  Object.values(s.teams).some((t) => t.morale <= 0 || t.cups >= 5);
function opponent(s, source, visited, direction) {
  const p = s.players[source];
  for (let step = 1; step < s.players.length; step++) {
    const candidate =
      s.players[
        (source + step * direction + s.players.length) % s.players.length
      ];
    if (candidate.team !== p.team && !visited.has(candidate.id))
      return candidate;
  }
  return null;
}
function scoreResources(before, after, id) {
  const own = before.players[id].team;
  let morale = 0,
    healing = 0,
    shields = 0,
    energy = 0;
  for (const [team, data] of Object.entries(before.teams)) {
    const sign = team === own ? 1 : -1;
    morale += sign * (after.teams[team].morale - data.morale) * 30;
  }
  for (const p of before.players) {
    const next = after.players[p.id],
      sign = p.team === own ? 1 : -1;
    healing += sign * (next.healing - p.healing) * 2.5;
    energy +=
      sign *
      (next.energy.gem +
        next.energy.crystal -
        p.energy.gem -
        p.energy.crystal) *
      4;
    shields +=
      sign *
      (Number(next.effects.some((e) => e.name === "holyShield")) -
        Number(p.effects.some((e) => e.name === "holyShield"))) *
      3;
  }
  return { morale, healing, shields, energy };
}
function hit(state, targetId, amount) {
  const p = state.players[targetId];
  const shield = p.effects.find((e) => e.name === "holyShield");
  if (shield) {
    p.effects = p.effects.filter((e) => e !== shield);
    return false;
  }
  // Spend only healing needed to avoid overflow. This matches the public
  // response rule, and avoids scoring a hypothetical choice via value().
  const max = Math.min(p.healing, p.hero === "priest" ? 1 : amount);
  const heal = Math.min(max, Math.max(0, p.count + amount - p.limit));
  p.healing -= heal;
  const drawn = amount - heal,
    overflow = Math.max(0, p.count + drawn - p.limit);
  p.count = Math.min(p.limit, p.count + drawn);
  let loss = overflow;
  for (const angel of state.players.filter(
    (t) => t.team === p.team && hasSkill(t, "divineShelter"),
  )) {
    const used = Math.min(loss, angel.energy.gem + angel.energy.crystal);
    payEnergy(state, angel.id, used);
    loss -= used;
  }
  state.teams[p.team].morale -= loss;
  return true;
}
function responseProbabilities(state, targetId, observerId) {
  const p = state.players[targetId];
  if (targetId === observerId) {
    const light = p.hand.find((c) => c.name === "holyLight");
    const magic = p.hand.find(
      (c) =>
        c.name === "magicBullet" ||
        (hasSkill(p, "magicFusion") &&
          c.elements.some((e) => e === "earth" || e === "fire")),
    );
    // Only our own cards are known. Shield handles a passed response for free.
    if (p.effects.some((e) => e.name === "holyShield"))
      return { hit: 1, light: 0, relay: 0 };
    if (light) return { hit: 0, light: 1, relay: 0, card: light };
    if (magic) return { hit: 0, light: 0, relay: 1, card: magic };
    return { hit: 1, light: 0, relay: 0 };
  }
  const relay = hasSkill(p, "magicFusion") ? fusionRate : relayRate;
  const response = 1 - (1 - lightRate - relay) ** p.count;
  return {
    hit: 1 - response,
    light: (response * lightRate) / (lightRate + relay),
    relay: (response * relay) / (lightRate + relay),
  };
}
function relayOutcomes(
  state,
  observerId,
  sourceId,
  targetId,
  amount,
  visited,
  direction,
  remaining,
) {
  const rates = responseProbabilities(state, targetId, observerId),
    own = state.players[observerId].team;
  const result = [];
  if (rates.hit) {
    const next = clone(state);
    const dealt = hit(next, targetId, amount);
    result.push({
      probability: rates.hit,
      state: next,
      response: 0,
      elementGain: dealt && sourceId === observerId,
      path: [`hit:${targetId}:${amount}`],
    });
  }
  for (const type of ["light", "relay"])
    if (rates[type]) {
      const next = clone(state),
        target = next.players[targetId];
      if (rates.card) {
        target.hand = target.hand.filter((c) => c.id !== rates.card.id);
      }
      target.count = Math.max(0, target.count - 1);
      // Only count the actual response card, not its effect on hypothetical future
      // hand burden. Light is a scarcer public defensive resource than a relay.
      const response =
        (target.team === own ? -1 : 1) * (type === "light" ? 3 : 1.5);
      const nextVisited = new Set(visited);
      nextVisited.add(targetId);
      if (nextVisited.size === state.players.length) nextVisited.clear();
      const nextTarget =
        type === "relay" && remaining > 1
          ? opponent(next, targetId, nextVisited, direction)
          : null;
      if (nextTarget) {
        for (const branch of relayOutcomes(
          next,
          observerId,
          targetId,
          nextTarget.id,
          amount + 1,
          nextVisited,
          direction,
          remaining - 1,
        ))
          result.push({
            ...branch,
            probability: branch.probability * rates[type],
            response: response + branch.response,
            path: [`relay:${targetId}`, ...branch.path],
          });
      } else
        result.push({
          probability: rates[type],
          state: next,
          response,
          path: [`${type}:${targetId}${type === "relay" ? ":horizon" : ""}`],
        });
    }
  return result;
}
function triggerValue(g, id, afterSpend, branches) {
  const p = afterSpend.players[id];
  const ongoing = branches.filter((b) => !terminal(b.state));
  let result = 0;
  if (hasSkill(p, "immortality"))
    result += ongoing.reduce(
      (n, b) =>
        n +
        b.probability *
          Math.min(
            1,
            Math.max(
              0,
              b.state.players[id].healingLimit - b.state.players[id].healing,
            ),
          ) *
          2.5,
      0,
    );
  if (
    hasSkill(p, "elementAbsorption") &&
    (g.player(id).hero.state?.elements ?? 0) < 3
  )
    result += ongoing.reduce(
      (n, b) => n + (b.elementGain ? b.probability * 1.5 : 0),
      0,
    );
  if (hasSkill(p, "spellExcitation")) {
    // One real follow-up attack from the remaining known hand. Do not award an
    // unconditional extra-action bonus when there is no usable attack.
    result += ongoing.reduce(
      (n, b) =>
        n +
        b.probability *
          Math.max(
            0,
            // This follow-up rests on an uncertain relay branch. Do not turn
            // its conditional lethal into the evaluator's certain-win bonus.
            bestAttack({ ...b.state, uncertain: true }, id, {
              depth: 1,
              sequence: false,
            }).score,
          ),
      0,
    );
  }
  return result;
}
export function evaluateMagicAction(g, id, action, state = stateOf(g, id)) {
  const card =
    action.type === "play"
      ? g.player(id).hand[action.index]
      : g.cards.get(action.cardIds?.[0]);
  if (
    !card ||
    !(
      (action.type === "play" && card.name === "magicBullet") ||
      (action.type === "skill" && action.skillId === "magicFusion")
    )
  )
    return null;
  const targetId = action.targetId ?? action.targetIds?.[0];
  if (targetId == null) return null;
  const next = clone(state),
    known = next.players[id].hand.find((c) => c.id === card.id);
  if (!known) return null;
  spend(next, id, [known]);
  // Prayer resolves when the water card is used, before anyone responds to the
  // magic. The new healing may protect a later teammate in this same relay.
  if (!terminal(next) && hasSkill(next.players[id], "frostPrayer") &&
    card.getTraits({ game: g, playerId: id }).elements.includes("water")) {
    const recipient = next.players
      .filter((p) => p.team === next.players[id].team && p.healing < p.healingLimit)
      .sort((a, b) => b.count - a.count || a.id - b.id)[0];
    if (recipient) recipient.healing++;
  }
  const forward = opponent(next, id, new Set([id]), 1);
  const direction = forward?.id === targetId ? 1 : -1;
  const branches = terminal(next)
    ? [
        {
          probability: 1,
          state: next,
          response: 0,
          path: ["exposure-terminal"],
        },
      ]
    : relayOutcomes(
        next,
        id,
        id,
        targetId,
        2,
        new Set([id]),
        direction,
        MAX_RELAY_TARGETS,
      );
  const own = state.players[id].team,
    enemy = own === "red" ? "blue" : "red";
  const expected = {
    morale: 0,
    healing: 0,
    shields: 0,
    energy: 0,
    responses: 0,
  };
  let winProbability = 0,
    lossProbability = 0;
  for (const branch of branches) {
    const part = scoreResources(state, branch.state, id);
    for (const key of Object.keys(part))
      expected[key] += branch.probability * part[key];
    expected.responses += branch.probability * branch.response;
    if (
      branch.state.teams[enemy].morale <= 0 &&
      branch.state.teams[own].morale > 0
    )
      winProbability += branch.probability;
    if (branch.state.teams[own].morale <= 0)
      lossProbability += branch.probability;
  }
  const triggers = triggerValue(g, id, next, branches);
  const cost = Math.max(1, cardScore(g, id, card) / 20);
  const terminalScore =
    (winProbability >= 1 - 1e-9 ? 100000 : 150 * winProbability) -
    (lossProbability >= 1 - 1e-9 ? 100000 : 150 * lossProbability);
  return {
    score:
      Object.values(expected).reduce((a, b) => a + b, 0) +
      triggers -
      cost +
      terminalScore,
    explanation: {
      ...expected,
      triggers,
      cardCost: cost,
      terminal: terminalScore,
      winProbability,
      lossProbability,
      direction,
      relayTargetLimit: MAX_RELAY_TARGETS,
    },
    branches,
  };
}
export const magicActionScore = (g, id, action, state) =>
  evaluateMagicAction(g, id, action, state)?.score;
