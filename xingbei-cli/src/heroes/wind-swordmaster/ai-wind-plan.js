import { elementsOf } from "../shared/ai/base/evaluation.js";

// Search own cards and the real extra-action queue, stopping at the third attack.
// No Game mutation, random sampling or prediction of opponents' private cards.
export function planWindAttacks(game, playerId, { offer = null, card = null, energy = null } = {}) {
  const player = game.player(playerId), turn = game.turn.state;
  const skills = new Set(player.getSkills().map(({ skill }) => typeof skill === "string" ? skill : skill.id));
  const cards = player.hand.filter(card => card.type === "attack");
  const wind = card => elementsOf(game, playerId, card).includes("wind");
  const startCount = turn?.attackCount ?? 0;
  const pending = (turn?.pendingActions ?? []).map(action => action.element ?? null);
  const availableEnergy = energy ?? player.energy.gem + player.energy.crystal;
  const used = turn?.usedSkills ?? {};
  let best = { count: startCount, score: -Infinity, steps: [], offers: [] };
  function finish(count, cost, order, steps, offers) {
    const score = count * 1000 - cost * 50 + order;
    if (score > best.score) best = { count, score, steps, offers };
  }
  function ready(hand, count, queue, windUsed, shadowUsed, energyLeft, cost, order, steps, offers, initial = false) {
    finish(count, cost, order, steps, offers);
    if (count >= 3 || (!initial && !queue.length)) return;
    const index = queue.findLastIndex(element => element != null);
    const slot = index >= 0 ? index : 0;
    const restriction = initial ? null : queue[slot];
    for (const next of hand) {
      if (restriction && !elementsOf(game, playerId, next).includes(restriction)) continue;
      const rest = hand.filter(card => card !== next), restQueue = [...queue];
      if (!initial) restQueue.splice(slot, 1);
      const sequence = [...steps, next.id];
      // Keep wind until it can consume Wind Fury; prefer a wind Gale Art as attack #2.
      const preference = order + (next.hasUniqueSkill("galeArt") ? (wind(next) && count === 1 ? 15 : 4) : 0) - (count === 0 && wind(next) ? 20 : 0);
      after(rest, count + 1, restQueue, windUsed, shadowUsed, energyLeft, cost, preference, sequence, offers, next, ["galeArt", "windFury", "swordShadow"], false);
    }
  }
  function after(hand, count, queue, windUsed, shadowUsed, energyLeft, cost, order, steps, offers, played, allowed, root) {
    const candidates = [];
    if (skills.has("galeArt") && allowed.includes("galeArt") && played?.hasUniqueSkill("galeArt")) candidates.push("galeArt");
    if (skills.has("windFury") && allowed.includes("windFury") && !windUsed && hand.some(wind)) candidates.push("windFury");
    if (skills.has("swordShadow") && allowed.includes("swordShadow") && !shadowUsed && energyLeft > 0) candidates.push("swordShadow");
    for (let mask = 0; mask < (1 << candidates.length); mask++) {
      const selected = candidates.filter((_, index) => mask & (1 << index));
      const nextQueue = [...queue, ...selected.map(skill => skill === "windFury" ? "wind" : null)];
      ready(hand, count, nextQueue, windUsed || selected.includes("windFury"), shadowUsed || selected.includes("swordShadow"), energyLeft - Number(selected.includes("swordShadow")), cost + Number(selected.includes("swordShadow")) + Number(selected.includes("galeArt")) * 0.1, order, steps, root ? selected : offers);
    }
  }
  if (offer) {
    const allowed = offer === "galeArt" ? ["galeArt", "windFury", "swordShadow"] : offer === "windFury" ? ["windFury", "swordShadow"] : ["swordShadow"];
    after(cards, startCount, pending, !!used.windFury, !!used.swordShadow, availableEnergy, 0, 0, [], [], card, allowed, true);
  } else ready(cards, startCount, pending, !!used.windFury, !!used.swordShadow, availableEnergy, 0, 0, [], [], !turn?.completed);
  return best;
}
