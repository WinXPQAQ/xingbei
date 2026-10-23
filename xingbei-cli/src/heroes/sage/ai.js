import { sameElements } from "../../card-sets.js";

function reboundScore(game, id, state, indexes, targetId, api) {
  const { copy, spend, terminal, evaluate, hurt, cardCost } = api;
  const cards = indexes.map((i) => game.player(id).hand[i]);
  const next = copy(state), p = next.players[id];
  const stateCards = cards.map((c) => p.hand.find((item) => item.id === c.id));
  if (stateCards.some((c) => !c)) return -Infinity;
  spend(next, id, stateCards);
  if (terminal(next)) return evaluate(next) - evaluate(state);
  hurt(next, targetId, cards.length - 1);
  if (!terminal(next)) hurt(next, id, cards.length);
  return evaluate(next) - evaluate(state) - cardCost(game, id, cards);
}

export const sageAi = {
  id: "sage",
  cardBonus: ({ same }) => same ? 3 : 16,
  acceptsRefine: (action) => action.stones.crystal === 0,
  resourceValue: (p) => Math.min(3, p.energy.gem) * 5 + Math.max(0, p.energy.gem - 3) * 2,
  refineBonus: ({ player, gem }) => gem && !player.energy.gem ? 8 : 0,
  afterDamage({ state, id, player, actual, type }, { energy, discardEstimate }) {
    if (type !== "spell" || actual <= 3) return;
    player.energy.gem += Math.min(2, Math.max(0, player.energyLimit - energy(player)));
    discardEstimate(state, id, 1);
  },
  scoreSkill({ next, id, player, action, costs, targetId, skillId }, { hurt, heal, terminal }) {
    if (skillId === "arcaneCodex") {
      if (next.players[targetId].team === player.team) return null;
      hurt(next, targetId, costs.length - 1);
      if (!terminal(next)) hurt(next, id, costs.length - 1);
      return 0;
    }
    if (skillId === "holyCodex") {
      if (action.targetIds.some((target) => next.players[target].team !== player.team)) return null;
      for (const target of action.targetIds) heal(next, target, 2);
      hurt(next, id, costs.length - 1);
      return 0;
    }
    return null;
  },
  decisions: {
    spellRebound({ game, id, state, request, context, player }, api) {
      if (request.type === "cardChoice" && request.validSets) {
        return api.foes(state, id).map((target) => api.bestCardSet(game, id, target.id, request.validSets, sameElements,
          (indexes) => reboundScore(game, id, state, indexes, target.id, api)))
          .sort((a, b) => b.score - a.score)[0]?.indexes ?? null;
      }
      if (request.type === "playerChoice") return request.choices.map((c) => ({ value: c.value,
        score: state.players[c.value].team === player.team ? -1e6 : api.damageGain(state, id, c.value, context.amount ?? 1),
      })).sort((a, b) => b.score - a.score)[0].value;
    },
  },
};
