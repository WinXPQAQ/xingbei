import { damageTarget } from "../shared/ai/decisions.js";
import { createDeck } from "../../cards.js";

// Use the printed deck distribution, never the hidden draw order. Cards with
// identical lesson effects share one branch.
const lessonDraws = (() => {
  const deck = createDeck(), groups = new Map();
  for (const card of deck) {
    const traits = card.getTraits();
    const effects = {
      spell: card.type === "spell",
      fate: traits.fates.includes("Y"),
      water: traits.elements.includes("water"),
    };
    const key = JSON.stringify(effects);
    const group = groups.get(key) ?? { ...effects, probability: 0 };
    group.probability += 1 / deck.length;
    groups.set(key, group);
  }
  return [...groups.values()];
})();

function lessonEffects(state, id, effects, api) {
  if (effects.spell) {
    const targets = api.foes(state, id).map(player => ({
      id: player.id, score: api.damageGain(state, id, player.id, 1),
    })).sort((a, b) => b.score - a.score).slice(0, 2);
    const seats = state.players.length;
    targets.sort((a, b) => (a.id - id + seats) % seats - (b.id - id + seats) % seats);
    for (const target of targets) {
      api.hurt(state, target.id, 1);
      if (api.terminal(state)) return;
    }
  }
  if (api.terminal(state)) return;
  if (effects.fate) {
    const targets = state.players.map(player => ({
      id: player.id, score: api.damageGain(state, id, player.id, 1),
    })).sort((a, b) => b.score - a.score);
    api.hurt(state, targets[0].id, 1);
  }
  if (api.terminal(state) || !effects.water) return;
  const targets = state.players.map(player => {
    const next = api.copy(state);
    api.heal(next, player.id, 1);
    return { id: player.id, score: api.evaluate(next) };
  }).sort((a, b) => b.score - a.score);
  api.heal(state, targets[0].id, 1);
}

function sparkValue(state, id, count, triggered, api) {
  const next = api.copy(state);
  if (triggered) api.discardEstimate(next, id, Math.min(2, next.players[id].count));
  const team = next.teams[next.players[id].team], before = team.gem;
  if (count === 3) api.stones(next, next.players[id].team, "gem", 2);
  // Readiness premium makes a safe one-morale trade for two usable team gems
  // attractive. A full trophy area grants no premium.
  const readiness = (team.gem - before) * 16;
  return { state: next, score: api.evaluate(next) + readiness };
}

function lessonValue(state, id, api) {
  const drawn = api.copy(state), count = (drawn.players[id].heroState.lessons ?? 0) + 1;
  drawn.players[id].heroState.lessons = count;
  api.draw(drawn, id, 1);
  if (api.terminal(drawn)) return api.evaluate(drawn);
  return lessonDraws.reduce((sum, effects) => {
    const next = api.copy(drawn);
    lessonEffects(next, id, effects, api);
    if (api.terminal(next)) return sum + effects.probability * api.evaluate(next);
    const triggered = effects.spell || effects.fate || effects.water;
    const spark = sparkValue(next, id, count, triggered, api);
    let score = Math.max(api.evaluate(next), spark.score);
    // Only a failed lesson grants the extra spell action. Look ahead through
    // the third lesson, then let the actual next decision select its action.
    if (!triggered && count < 3) score += Math.max(0, lessonValue(spark.state, id, api) - api.evaluate(spark.state));
    return sum + effects.probability * score;
  }, 0);
}

export const nobleLadyAi = {
  id: "nobleLady",
  energyPreference: "mixed",
  cardBonus: ({ card, elements }) =>
    card.type === "spell" ||
    card.fates.includes("Y") ||
    elements.includes("water")
      ? 5
      : 0,
  refineBonus: ({ gem, player }) =>
    gem && player.energy.gem + player.energy.crystal <= 1 ? 7 : 0,
  scoreSkill({ next, id, skillId }, api) {
    if (skillId !== "magicLesson") return null;
    return lessonValue(next, id, api) - api.evaluate(next) + 3;
  },
  decisions: {
    magicSpark: ({ context, state, id }, api) =>
      !context.triggered || sparkValue(state, id, context.count, true, api).score > api.evaluate(state),
    friendshipBond: ({ player }) => player.count >= player.limit - 1,
    friendshipTargets: ({ request, state }) =>
      [...request.choices].sort(
        (a, b) => state.players[b.value].count - state.players[a.value].count,
      )[0].value,
    lessonSpellTargets: damageTarget,
    lessonFateTargets: damageTarget,
    wishFulfillment: ({ player, request }) =>
      player.count !== 4 &&
      player.energy.gem + player.energy.crystal > (request.reservedEnergy ?? 0),
    sharedWish: ({ state, player, id }) =>
      state.players.some(
        (p) =>
          p.id !== id && (p.team === player.team ? p.count < 3 : p.count > 5),
      ),
    wishTarget: ({ request, state, player }) =>
      [...request.choices].sort((a, b) => {
        const score = (id) =>
          (state.players[id].team === player.team ? 1 : -1) *
          (4 - state.players[id].count);
        return score(b.value) - score(a.value);
      })[0].value,
  },
};
