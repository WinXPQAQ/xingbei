import { createDeck } from "../../cards.js";
import { cheapCards, damageTarget, discardTarget } from "../shared/ai/decisions.js";
const noteKind = (element) => element === "water" ? "water" : ["wind", "earth"].includes(element) ? "wind" : "fire";
// This distribution is the printed deck, never the live draw pile.
const printed = createDeck(), rates = ["water", "wind", "fire"].map((kind) => ({
  kind, probability: printed.filter((card) => noteKind(card.elements[0]) === kind).length / printed.length,
}));
const notesOf = (source) => source.covered.filter((card) => card.location.pile === "notes");
const kindsOf = (a, api, card) => [...new Set(api.elements(a.game, a.id, card).map(noteKind))];
function effectScore(a, api, effect, targetId) {
  const next = api.copy(a.state);
  if (effect === "heal") {
    if (!next.players[targetId].healingDisabled) api.heal(next, targetId, 1);
  } else if (effect === "discard") api.discardEstimate(next, targetId, 1);
  else api.hurt(next, targetId, 1);
  return api.evaluate(next) - api.evaluate(a.state);
}
function movement(a, api, kinds, cache) {
  if (kinds.length < 3) return 0;
  const key = kinds.join(",");
  if (cache.has(key)) return cache.get(key);
  const [first, middle, last] = kinds;
  const selector = last === "fire" ? first : last;
  const targets = a.state.players.filter((p) => selector === "water" ||
    (selector === "wind" ? p.team !== a.player.team : p.id === a.id));
  const effect = middle === "water" ? "heal" : middle === "wind" ? "discard" : "damage";
  const gains = targets.map((p) => effectScore(a, api, effect, p.id)).sort((x, y) => y - x);
  // A whole movement is optional, but its chosen one/two targets are not.
  const score = Math.max(0, gains.slice(0, last === "fire" ? 1 : 2).reduce((sum, value) => sum + value, 0));
  cache.set(key, score);
  return score;
}
function forecasts(a, api) {
  const cache = new Map(), memo = new Map();
  function random(kinds, count) {
    if (!count) return 0;
    const key = `${kinds.join(",")}:${count}`;
    if (memo.has(key)) return memo.get(key);
    const score = rates.reduce((sum, { kind, probability }) => {
      const next = [...kinds.slice(-2), kind];
      return sum + probability * (movement(a, api, next, cache) + (count > 2 ? 1 : .5) * random(next, count - 1));
    }, 0);
    memo.set(key, score);
    return score;
  }
  const withCards = (cards, follow = 0) => {
    const visit = (index, kinds) => index === cards.length
      ? movement(a, api, kinds, cache) + random(kinds, follow)
      : Math.max(...kindsOf(a, api, cards[index]).map((kind) => visit(index + 1, [...kinds, kind])));
    return visit(0, []);
  };
  const afterRandom = (cards, count) => {
    const visit = (index, kinds) => index === cards.length ? random(kinds, count)
      : Math.max(...kindsOf(a, api, cards[index]).map((kind) => visit(index + 1, [...kinds, kind])));
    return visit(0, []);
  };
  return { withCards, afterRandom };
}
function concertoPlan(a, api, count = null, replacements = null) {
  const notes = notesOf(a.source), forecast = forecasts(a, api);
  let best = { score: -Infinity, removed: [] };
  for (let mask = 1; mask < 1 << notes.length; mask++) {
    const removed = notes.filter((_, index) => mask & 1 << index);
    if (count != null && removed.length !== count) continue;
    const kept = notes.filter((_, index) => !(mask & 1 << index));
    // Replacements finish below three notes; normal action and the next turn
    // supply the next two notes. Only the latter is discounted.
    const score = forecast.afterRandom(kept, (replacements ?? removed.length - 1) + 2);
    if (score > best.score) best = { score, removed };
  }
  return best;
}
function soloPlan(a, api) {
  const notes = notesOf(a.source).slice(-2), forecast = forecasts(a, api);
  return a.source.hand.map((card, index) => {
    const next = api.copy(a.state);
    api.remove(next, a.id, [next.players[a.id].hand.find((c) => c.id === card.id)]);
    const score = forecast.withCards([...notes, card]) + api.evaluate(next) - api.evaluate(a.state) - api.cardCost(a.game, a.id, [card]);
    return { index, score };
  }).sort((x, y) => y.score - x.score)[0];
}
export const orchestraLeaderAi = {
  id: "orchestraLeader",
  energyPreference: "crystal",
  cardBonus: ({ elements }) =>
    elements.includes("water")
      ? 12
      : elements.some((e) => ["wind", "earth"].includes(e))
        ? 6
        : 0,
  resourceValue: (p) => p.coveredCount * 2,
  attackHitBonus: () => 3,
  decisions: {
    barlettaMinor: ({ player, request }) =>
      request.type === "skillChoice"
        ? player.count >= player.limit - 1
        : undefined,
    newMovement: (a, api) => a.request.type !== "skillChoice" ? undefined :
      (a.context.targetIds ?? []).map((id) => effectScore(a, api, a.context.effect, id))
        .sort((x, y) => y - x).slice(0, a.context.count ?? 1).reduce((sum, score) => sum + score, 0) > 0,
    movementdamage: damageTarget,
    movementdiscard: discardTarget,
    movementheal: (a, api) => [...a.request.choices].sort((x, y) =>
      effectScore(a, api, "heal", y.value) - effectScore(a, api, "heal", x.value))[0]?.value ?? a.request.defaultValue,
    provenceConcerto: (a, api) => {
      const next = api.copy(a.state), team = next.teams[a.player.team];
      const blue = Math.min(2, team.crystal); team.crystal -= blue; team.gem -= 2 - blue;
      next.players[a.id].coveredCount--;
      const cost = api.evaluate(next) - api.evaluate(a.state);
      const baseline = forecasts(a, api).afterRandom(notesOf(a.source), 2);
      return concertoPlan(a, api).score + cost > baseline;
    },
    concertoStones: ({ request }) => request.choices[0].value,
    concertoCount: (a, api) => concertoPlan(a, api).removed.length,
    concertoNote: (a, api) => concertoPlan(a, api, a.context.count ?? 1, a.context.drawCount)
      .removed.find((card) => a.request.choices.some((choice) => choice.value === card.id))?.id ?? a.request.defaultValue,
    naplesSolo: (a, api) => {
      if (!a.context.card) return false;
      const next = api.copy(a.state); api.payEnergy(next, a.id);
      const cost = api.evaluate(next) - api.evaluate(a.state);
      const notes = [...notesOf(a.source).slice(-2), a.context.card];
      // A hit-time note still has the action-end note ahead. Solo locks that
      // note (and pending extra actions) out, so compare their expected value.
      const more = a.context.count ?? 0;
      const extra = (a.game.turn.state?.pendingActions ?? []).length ? 1 : 0;
      const baseline = forecasts(a, api).withCards(notes, Math.min(2, more + extra));
      return (soloPlan(a, api)?.score ?? -Infinity) + cost > baseline;
    },
    soloCard: (a, api) => {
      const best = soloPlan(a, api);
      return best && a.request.valid.includes(best.index) ? [best.index] : cheapCards(a, api);
    },
    noteElement: ({ request }) =>
      request.choices.find((c) => c.value === "water")?.value ??
      request.defaultValue,
  },
};
