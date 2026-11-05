import { damageTarget, discardTarget } from "../shared/ai/decisions.js";

const elements = (card, id) => card.traits?.[id]?.elements ?? card.elements;
const same = (a, b, id) => elements(a, id).some(e => elements(b, id).includes(e));
const pairs = cards => cards.flatMap((a, i) => cards.slice(i + 1).map(b => [a, b]));
const shadows = ({ game, id, state }) => state.players[id].heroState.shadowEstimate ??
  game.player(id).covered.filter(c => c.location.pile === "shadow");
const hasPair = (cards, id) => pairs(cards).some(([a, b]) => same(a, b, id));
// Shadows are resources, not hand cards. Preserve compatible elements when
// collecting or overflowing; a holy light shadow has no defensive hand value.
function trimShadows(cards, id) {
  if (cards.length <= 3) return cards;
  return cards.map((_, i) => cards.filter((__, j) => j !== i))
    .sort((a, b) => Number(hasPair(b, id)) - Number(hasPair(a, id)))[0];
}
function setShadows(state, id, cards) {
  const p = state.players[id];
  p.heroState.shadowEstimate = cards;
  p.coveredCount = cards.length;
}
function giftGain(state, targetId, api) {
  const next = api.copy(state);
  api.draw(next, targetId, 1);
  return api.evaluate(next) - api.evaluate(state);
}
function servicePlan(a, api, required = []) {
  const { state, id } = a, cards = shadows(a);
  let best = { cards: [], score: 0 };
  for (const pair of pairs(cards).filter(cs => required.every(cid => cs.some(c => c.id === cid)))) {
    const next = api.copy(state), p = next.players[id];
    setShadows(next, id, cards.filter(c => !pair.includes(c)));
    p.heroState.threads = Math.min(4, (p.heroState.threads ?? 0) + 1);
    const matched = same(...pair, id);
    if (matched) p.heroState.form = "shadowPrison";
    const gift = matched ? Math.max(...state.players.map(t => giftGain(next, t.id, api))) : 0;
    const score = api.evaluate(next) - api.evaluate(state) + gift;
    if (score > best.score || (required.length && !best.cards.length)) best = { cards: pair, score };
  }
  return best;
}
function servicePotential(a, api) {
  return hasPair(shadows(a), a.id) ? Math.max(0, servicePlan(a, api).score) : 0;
}
function flashPlan(a, api, allowed = null) {
  const { state, id } = a, p = state.players[id];
  if (p.heroState.flashUsed || api.terminal(state)) return { card: null, score: 0 };
  let best = { card: null, score: 0 };
  const cards = shadows(a), before = api.evaluate(state), service = servicePotential(a, api);
  for (const card of cards.filter(c => !allowed || allowed.has(c.id))) {
    const next = api.copy(state), owner = next.players[id];
    setShadows(next, id, cards.filter(c => c.id !== card.id));
    owner.heroState.flashActive = owner.heroState.flashUsed = true;
    // One additional attack only, obeying public card/target restrictions even
    // though its action has not yet been granted. No recursive continuation.
    let attack = -Infinity;
    for (const entry of a.game.attackFollowups ?? []) {
      const selected = next.players[id].hand.find(c => c.id === entry.cardId);
      if (selected) for (const targetId of entry.targets)
        attack = Math.max(attack, api.attackScore(a.game, id, next, selected, targetId, { follow: false }));
    }
    if (!Number.isFinite(attack)) continue;
    const score = api.evaluate(next) - before + attack +
      servicePotential({ ...a, state: next }, api) - service;
    if (score > best.score) best = { card, score };
  }
  return best;
}
function shadowChoice(a, remove = false) {
  const cards = shadows(a), choices = a.request.choices.filter(c => a.game.cards.has(c.value));
  return choices.map(choice => {
    const remaining = remove ? cards.filter(c => c.id !== choice.value)
      : trimShadows([...cards, a.game.cards.get(choice.value)], a.id);
    return { value: choice.value, score: Number(hasPair(remaining, a.id)) };
  }).sort((x, y) => y.score - x.score)[0]?.value ?? a.request.defaultValue;
}
function shadowHandPair(a, api) {
  const { source, request, game, id } = a;
  const indexes = request.valid ?? source.hand.map((_, i) => i);
  const sets = request.validSets ?? pairs(indexes);
  const reserved = new Set(game.turn.state?.reservedCardIds ?? []);
  return [...sets].map(set => {
    const cards = set.map(i => source.hand[i]);
    const compatible = hasPair([...shadows(a), ...cards], id);
    const cost = api.cardCost(game, id, cards) + cards.filter(c => reserved.has(c.id)).length * 1000;
    return { set, score: Number(compatible) * 8 - cost };
  }).sort((x, y) => y.score - x.score)[0]?.set ?? null;
}
export const headMaidAi = {
  id: "headMaid",
  sharedDecisionSkills: ["calmWind"],
  energyPreference: "gem",
  cardBonus: ({ card }) => card.type === "attack" ? 9 : 0,
  resourceValue: p => (p.heroState.threads ?? 0) * 3 + (p.coveredCount ?? 0) * 3 + (p.heroState.form ? 3 : 0),
  beforeAttackHit(a) {
    a.player.heroState.maidMiss = false;
    if (a.active && !a.player.heroState.flashActive)
      setShadows(a.state, a.id, trimShadows([...shadows(a), a.card], a.id));
  },
  afterAttackMiss: ({ player, active }) => { player.heroState.maidMiss = active; },
  followAttackScore(a, api) {
    if (!a.active) return 0;
    const before = servicePotential(a, api);
    return a.branches.reduce((sum, branch) => {
      if (api.terminal(branch.state)) return sum;
      const context = { ...a, state: branch.state };
      const service = servicePotential(context, api) - before;
      const flash = branch.state.players[a.id].heroState.maidMiss ? flashPlan(context, api).score : 0;
      return sum + branch.probability * (service + flash);
    }, 0);
  },
  uncounterable: ({ player, active }) => active && player.heroState.flashActive,
  acceptsRefine: a => !a.stones.crystal,
  refineBonus: ({ player }) => !player.energy.gem ? 4 : 0,
  decisions: {
    shadowHole: () => true,
    shadowHoleTarget: discardTarget,
    trueShadow: ({ player, request }) => player.coveredCount < 2 && player.count >= 4 &&
      player.energy.gem > (request.reservedEnergy ?? 0),
    trueShadowCards: shadowHandPair,
    shadowCopy: () => true,
    flashKill: (a, api) => flashPlan(a, api, new Set(a.request.choices.map(c => c.value))).card?.id ?? null,
    shadowStitch: ({ request, context, state }) => Math.min(
      Math.max(...request.choices.map(c => c.value)), state.players[context.targetId].count + 1),
    shadowStitchCard: a => shadowChoice(a),
    shadowOverflow: a => shadowChoice(a, true),
    wayOfService(a, api) {
      const selected = a.context.selectedCardIds ?? [], plan = servicePlan(a, api, selected);
      return plan.cards.find(c => !selected.includes(c.id))?.id ?? a.request.defaultValue;
    },
    serviceCard: ({ request }) => request.choices[0]?.value,
    serviceTarget: ({ request, state }, api) => [...request.choices]
      .sort((a, b) => giftGain(state, b.value, api) - giftGain(state, a.value, api))[0]?.value,
    shadowPrison: () => true,
    prisonRelease: () => true,
    prisonTarget: (a, api) => damageTarget(a, api, 2),
    calmWind: ({ player }) => player.count <= player.limit - 2,
  },
};
