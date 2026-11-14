import { holidayMageAi } from "../holiday-mage/ai.js";
import { cheapCards } from "../shared/ai/decisions.js";

// Save real magic bullets for protecting team morale. This is an opportunity
// cost, so an immediate winning play can still outweigh it.
const magicReserveValue = 48;
const isMagicBullet = card => card.name === "magicBullet";

function redirectDamage(state, id, card, actual, type, api) {
  const next = api.copy(state);
  api.spend(next, id, [card]);
  if (!api.terminal(next)) api.applyActualDamage(next, id, actual, type, false);
  return next;
}

function burstScore(a, api) {
  const initial = api.copy(a.next);
  api.stones(initial, a.player.team, "gem", 1);
  let branches = [{ state: initial, probability: 1, cost: 0 }];
  for (const targetId of a.action.targetIds) {
    branches = branches.flatMap(branch => {
      if (api.terminal(branch.state)) return [branch];
      const hit = api.copy(branch.state);
      api.hurt(hit, targetId, 2);
      let cost = branch.cost;
      if (!api.terminal(hit)) {
        const cards = hit.players[a.id].hand.filter(card => !card.reserve);
        cards.sort((left, right) => api.cardScore(a.game, a.id, a.game.cards.get(left.id))
          - api.cardScore(a.game, a.id, a.game.cards.get(right.id)));
        if (cards.length) {
          cost += api.cardCost(a.game, a.id, [a.game.cards.get(cards[0].id)]);
          if (isMagicBullet(cards[0])) cost += magicReserveValue;
          api.remove(hit, a.id, [cards[0]]);
        }
      }
      // Match the existing magic-girl estimate using public hand counts only.
      const hitChance = branch.state.players[targetId].count ? 0.55 : 1;
      const outcomes = [{ state: hit, probability: branch.probability * hitChance, cost }];
      if (hitChance < 1) {
        const discard = api.copy(branch.state);
        api.discardEstimate(discard, targetId, 1);
        outcomes.push({ state: discard, probability: branch.probability * (1 - hitChance), cost: branch.cost });
      }
      return outcomes;
    });
  }
  // The caller already accounts for the action's initial card payment.
  return branches.reduce((sum, branch) => sum + branch.probability *
    (api.evaluate(branch.state) - branch.cost), 0) - api.evaluate(a.next) + 3;
}

export const gluttonousGirlAi = {
  ...holidayMageAi,
  id: "gluttonousGirl",
  cardBonus: ({ card, elements }) =>
    card.name === "magicBullet"
      ? 95
      : card.type === "spell"
        ? 14
        : elements.some((e) => ["water", "fire"].includes(e))
          ? 6
          : 0,
  refineBonus: a => holidayMageAi.refineBonus(a) + (!a.player.energy.gem && a.gem ? 1 : 0),
  actionBonus({ game, id, action }) {
    const cards = action.type === "play" ? [game.player(id).hand[action.index]]
      : (action.cardIds ?? []).map(cardId => game.cards.get(cardId));
    return -magicReserveValue * cards.filter(card => card && isMagicBullet(card)).length;
  },
  responseBonus: ({ card }) => isMagicBullet(card) ? -magicReserveValue : 0,
  defenseRisk({ state, id, request }, api) {
    const card = state.players[id].hand.find(isMagicBullet);
    if (!card || request.context?.moraleLoss === false) return 0;
    const take = api.copy(state), type = request.attack ? "attack" : "spell";
    const actual = api.hurt(take, id, request.damage ?? request.context?.amount ?? 2, type,
      { sourceId: request.actor?.id ?? request.context?.sourceId });
    const prepared = api.copy(state);
    prepared.players[id].healing = take.players[id].healing;
    const redirected = redirectDamage(prepared, id, card, actual, type, api);
    return Math.min(0, api.evaluate(take) - api.evaluate(redirected) + magicReserveValue);
  },
  scoreSkill(a, api) {
    if (a.skillId === "deliciousFusion") {
      api.hurt(a.next, a.targetId, 2);
      return -2;
    }
    if (a.skillId === "magicBurst") {
      return burstScore(a, api);
    }
    return holidayMageAi.scoreSkill(a, api);
  },
  decisions: {
    appetiteBlackHole(a, api) {
      if (a.context.moraleLoss === false) return null;
      const indexes = cheapCards(a, api);
      if (!indexes?.length) return null;
      const take = api.copy(a.state), type = a.context.damageType ?? "spell";
      api.applyActualDamage(take, a.context.targetId, a.context.actual, type);
      const moraleSaved = a.state.teams[a.player.team].morale - take.teams[a.player.team].morale;
      if (moraleSaved <= 0) return null;
      const card = a.state.players[a.id].hand.find(c => c.id === a.source.hand[indexes[0]].id);
      const redirected = redirectDamage(a.state, a.id, card, a.context.actual, type, api);
      return api.evaluate(redirected) - magicReserveValue > api.evaluate(take) ? indexes : null;
    },
    threeSecondRule: ({ player, request }) =>
      request.type === "skillChoice" ? player.count < player.limit : undefined,
  },
};
