import { cheapCards } from "../shared/ai/decisions.js";
export const mischiefGirlAi = {
  id: "mischiefGirl",
  energyPreference: "crystal",
  cardBonus: ({ card }) =>
    card.hasUniqueSkill("angelWall")
      ? 24
      : card.name === "holyShield"
        ? 18
        : card.type === "spell"
          ? 12
          : 0,
  actionBonus({ game, state, id, player, action }) {
    const card = action.type === "play" ? game.player(id).hand[action.index] : null;
    if (card?.type !== "spell" && action.type !== "skill") return 0;
    const open = state.players.filter(p => !p.effects.some(e => e.name === "tricky") && !p.skillIds.includes("spiritWill")).length;
    // A spell prepares public Tricky slots; no concealed face is assumed.
    return Math.min(2, open) * 1.5 + (card?.name === "holyShield" &&
      state.players[action.targetId]?.team === player.team ? 1 : 0);
  },
  scoreSkill({ next, id, player, skillId, targetId }, api) {
    if (skillId === "angelWall") {
      next.players[targetId].effects.push({ name: "holyShield" });
      return next.players[targetId].team === player.team ? 5 : -20;
    }
    if (skillId === "rebelliousWall") {
      const t = next.players[targetId];
      return t.team === player.team &&
        t.effects.some((e) => e.name !== "holyShield")
        ? 10
        : -4;
    }
    if (skillId === "surprise")
      return player.count >= player.limit - 1 ? 5 : -8;
    return null;
  },
  sharedDecisionSkills: ["trickTreatCost"],
  decisions: {
    foreshadowCount: ({ request }) => request.choices.at(-1).value,
    trickyTarget: ({ request, state, player, id }, api) => [...request.choices]
      .sort((a,b) => {
        const score = targetId => api.damageGain(state,id,targetId,2) +
          (state.players[targetId].team !== player.team ? 1 : 0);
        return score(b.value)-score(a.value);
      })[0]?.value ?? request.defaultValue,
    trickyShot: () => true,
    trickyPeek: ({ request, game, state, id }, api) =>
      [...request.choices].filter((c) => game.cards.has(c.value))
        .sort((a, b) => api.damageGain(state, id, game.cards.get(b.value).location.playerId, 2) -
          api.damageGain(state, id, game.cards.get(a.value).location.playerId, 2))[0]?.value ?? request.defaultValue,
    trickyReveal: ({ request }) =>
      request.choices.find((c) => c.value != null)?.value ?? null,
    trickyCost(a, api) {
      if (a.context.targetId == null) return null;
      let best = { indexes: null, score: 0 };
      for (const index of a.request.valid) {
        const next = api.copy(a.state), card = a.source.hand[index];
        api.spend(next,a.id,[next.players[a.id].hand.find(c => c.id === card.id)]);
        api.hurt(next,a.context.targetId,2,"spell",{sourceId:a.id});
        const score = api.evaluate(next)-api.evaluate(a.state)-api.cardCost(a.game,a.id,[card]);
        if(score > best.score) best = { indexes:[index], score };
      }
      return best.indexes;
    },
    trickTreatCost: (a, api) =>
      a.player.count >= a.player.limit - 1 ? cheapCards(a, api) : null,
    trickTreatReward: ({ player }) => (player.count > 3 ? "turn" : "crystal"),
    surpriseCard: (a, api) => (a.player.count > 3 ? cheapCards(a, api) : null),
    rebelliousEffect: ({ request, game, player }) => {
      const priority = (value) => {
        const card = game.cards.get(value), effect = card?.attachment?.effectId;
        const relief = effect === "weakness" ? 3 : game.effects.get(effect)?.isSeal ? 2 : effect === "poison" ? 1 : 0;
        return relief * (game.player(card.location.playerId).team === player.team ? 1 : -1);
      };
      return [...request.choices].sort((a, b) => priority(b.value) - priority(a.value))[0]?.value ?? request.defaultValue;
    },
  },
};
