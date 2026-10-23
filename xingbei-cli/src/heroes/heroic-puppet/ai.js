import { sameElements, distinctElements } from "../../card-sets.js";

function runeSetScore(game, id, state, indexes, skillId, targetId, baseAmount, api) {
  const { copy, spend, terminal, evaluate, hurt, cardCost } = api;
  const cards = indexes.map((i) => game.player(id).hand[i]);
  const next = copy(state), p = next.players[id];
  const stateCards = cards.map((c) => p.hand.find((item) => item.id === c.id));
  if (stateCards.some((c) => !c)) return -Infinity;
  spend(next, id, stateCards);
  if (terminal(next)) return evaluate(next) - evaluate(state);
  const regular = copy(state), battle = skillId === "battleRuneStrike";
  if (battle) hurt(regular, targetId, baseAmount, "attack");
  hurt(next, targetId, battle ? baseAmount + cards.length - 1 : cards.length - 1, battle ? "attack" : "spell");
  return evaluate(next) - evaluate(regular) - cardCost(game, id, cards);
}
function bestRuneSet(game, id, state, skillId, targetId, baseAmount, validSets, api) {
  return api.bestCardSet(game, id, targetId, validSets, skillId === "magicRuneFusion" ? distinctElements : sameElements,
    (indexes) => runeSetScore(game, id, state, indexes, skillId, targetId, baseAmount, api));
}
function runeDecision({ game, id, state, request, context }, api) {
  if (request.type === "cardChoice" && request.validSets)
    return bestRuneSet(game, id, state, request.skillId, context.targetId, context.amount ?? 0, request.validSets, api).indexes;
  if (request.type === "numberChoice" && context.purpose === "extraRunes" && context.targetId != null) {
    let best = { value: 0, score: 0 };
    const base = api.damageGain(state, id, context.targetId, context.amount ?? 0, context.damageType ?? "spell");
    for (const item of request.choices) {
      const score = api.damageGain(state, id, context.targetId, (context.amount ?? 0) + item.value, context.damageType ?? "spell") - base - item.value * .75;
      if (score > best.score) best = { value: item.value, score };
    }
    return best.value;
  }
}
function echoGain(state, id, targetId, amount, { copy, hurt, evaluate }) {
  if (state.players[id].team !== state.players[targetId].team) return -1;
  const next = copy(state); hurt(next, targetId, amount, "spell", { moraleLoss: false });
  return evaluate(next) - evaluate(state);
}
function bestEcho(state, id, amount, excluded, api) {
  return state.players.filter((p) => p.id !== excluded).map((p) => ({ targetId: p.id, score: echoGain(state, id, p.id, amount, api) }))
    .sort((a, b) => b.score - a.score)[0] ?? { score: 0, targetId: null };
}

export const heroicPuppetAi = {
  id: "heroicPuppet",
  cardBonus: ({ same, player }) => same ? ((player.hero.state?.battleRunes ?? 0) > 0 ? 22 : 0) : 12,
  resourceValue: (p) => p.energy.gem * 4 + p.energy.crystal * 2 + (p.heroState.form ? 3 : 0),
  refineBonus: ({ player, gem }) => gem && !player.energy.gem ? 8 : 0,
  attackHitBonus({ game, id, state, player, active, targetId, amount }, api) {
    return active && (player.heroState.battleRunes ?? 0) > 0 ? bestRuneSet(game, id, state, "battleRuneStrike", targetId, amount, null, api).score : 0;
  },
  attackMissBonus({ game, id, state, player, active, targetId }, api) {
    if (!active) return 0;
    let bonus = 0;
    if ((player.heroState.magicRunes ?? 0) > 0) bonus = bestRuneSet(game, id, state, "magicRuneFusion", targetId, 0, null, api).score;
    if (!bonus && (player.heroState.battleRunes ?? 0) > 0 && !(player.heroState.magicRunes > 0)) bonus = 1;
    return bonus;
  },
  preparations({ state, id, player, card, options }, { copy, payEnergy, draw }) {
    if (card?.type !== "attack" || player.heroState.form || player.energy.gem <= 0 || player.hand.length < 3) return options;
    const prepared = copy(state); payEnergy(prepared, id, 1, "gem");
    prepared.players[id].heroState.form = "runeBurst"; prepared.players[id].limit++;
    draw(prepared, id, 1);
    options.push({ state: prepared, activated: "runeReconstruction" });
    return options;
  },
  decisions: {
    runeReconstruction({ game, id, state, source, request }, { activationUseful }) {
      if (request.type === "skillChoice") return activationUseful(game, id, state, request, "runeReconstruction");
      if (request.type === "numberChoice") {
        const pairs = source.hand.some((c, i) => source.hand.slice(i + 1).some((o) => sameElements(game, id, [c, o])));
        const diverse = source.hand.some((c, i) => source.hand.slice(i + 1).some((o) => distinctElements(game, id, [c, o])));
        return pairs ? (diverse ? 2 : 3) : 0;
      }
    },
    angerSuppression({ game, id, state, request, context, player }, api) {
      if (request.type !== "skillChoice") return;
      if ((player.heroState.magicRunes ?? 0) > 0 && context.targetId != null && bestRuneSet(game, id, state, "magicRuneFusion", context.targetId, 0, null, api).score > 0) return false;
      return (player.heroState.magicRunes ?? 0) < 2;
    },
    doubleEcho({ id, state, request, context }, api) {
      if (request.type === "skillChoice") {
        const next = api.copy(state); api.payEnergy(next, id);
        return bestEcho(next, id, Math.min(3, context.amount ?? 0), context.targetId, api).score + api.evaluate(next) - api.evaluate(state) > 1;
      }
      if (request.type === "playerChoice") return request.choices.map((c) => ({ value: c.value, score: echoGain(state, id, c.value, context.amount ?? 0, api) })).sort((a, b) => b.score - a.score)[0].value;
    },
    battleRuneStrike: runeDecision,
    magicRuneFusion: runeDecision,
  },
};
