import { cheapCards, damageTarget } from "../shared/ai/decisions.js";
const unique = (c) =>
  c.uniqueSkills.some(
    (s) => s.endsWith("Seal") || ["powerBlessing", "speedBlessing"].includes(s),
  );
export const spiritTideAi = {
  id: "spiritTide",
  energyPreference: "crystal",
  cardBonus: ({ card }) =>
    unique(card)
      ? 28
      : ["poison", "weakness", "holyShield"].includes(card.name)
        ? 22
        : 0,
  resourceValue: (p) => (p.heroState.surge ?? 0) * 3,
  refineBonus: ({ player, crystal }) => crystal && !player.energy.gem && !player.energy.crystal ? 7 : 0,
  actionBonus({ game, state, id, action }, api) {
    const card = action.type === "play" ? game.player(id).hand[action.index] : null;
    if (!card || !["poison", "weakness", "holyShield"].includes(card.name)) return 0;
    // Attaching an effect offers optional exorcism, not guaranteed useful damage.
    return 2 + Math.max(0, ...state.players.filter(p => p.team !== state.players[id].team)
      .map(p => api.damageGain(state, id, p.id, 1)));
  },
  scoreSkill({ skillId, next, id, player, targetId, costs }, api) {
    if (costs.length && unique(costs[0])) {
      next.players[targetId].effects.push({ name: skillId, source: id });
      api.discardEstimate(next, id, 1);
      return 3 + Math.max(0, ...next.players.filter(p => p.team !== player.team)
        .map(p => api.damageGain(next, id, p.id, 1)));
    }
    return null;
  },
  decisions: {
    spiritExorcismOffer: ({ state, id, player }, api) => state.players.some(p =>
      p.team !== player.team && api.damageGain(state, id, p.id, 1) > 0),
    spiritExorcism: damageTarget,
    echoSpirit({ state, id, player, context }, api) {
      const next = api.copy(state);
      for (const target of next.players.filter(p => p.team !== player.team && p.id !== context.playerId)) {
        api.hurt(next, target.id, 1, "spell", { sourceId: id });
        if (api.terminal(next)) break;
      }
      return api.evaluate(next) > api.evaluate(state);
    },
    ragingTide: ({ request, game, state, id }, api) =>
      [...request.choices].sort((a, b) => {
        const gain = (targetId) => api.damageGain(
          state, id, targetId, 1 + game.player(targetId).getBasicEffects().length,
        );
        return gain(b.value) - gain(a.value);
      })[0]?.value ?? request.defaultValue,
    seaPriestess: cheapCards,
  },
};
