// The evaluator returns plans; only the engine executes them. Ordinary actions
// are tentative until all activation effects and other players' responses finish.
const ordinary = action => action.type === 'play' || action.type === 'skill';
const plannedSkills = new Set(['shadowGathering', 'stealth', 'prayer', 'runeReconstruction', 'adjudicate']);

export function withActivationPlanning(policy) {
  const adapted = { ...policy,
    rankAiActions(game, id) {
      const ranked = policy.rankAiActions(game, id);
      if (!game.canActivate?.(id)) return ranked;
      const best = ranked.find(entry => ordinary(entry.action));
      const routes = ranked.filter(entry => !ordinary(entry.action));
      if (best) {
        const plan = { action: best.action, skillId: best.explanation?.activation ?? null,
          score: best.score, decisionAware: plannedSkills.has(best.explanation?.activation) ||
            ['magicSwordsman','assassin','prayer','heroicPuppet','inquisitor'].includes(game.player(id).hero.id) };
        routes.push({ action: { type: 'activate', plan }, score: best.score,
          reason: 'activation-and-followup', explanation: { ...best.explanation, plannedAction: best.action } });
      } else {
        // Some activations create their first playable card. Their legality is
        // decided by the engine; unknown-card utility remains an approximation.
        routes.push({ action: { type: 'activate' }, score: -1e6, reason: 'activation-without-known-followup' });
      }
      return routes.sort((a,b) => b.score-a.score);
    },
    chooseAiAction(game,id) { return adapted.rankAiActions(game,id)[0]?.action; },
    chooseAiRuleDecision(request,game) {
      if (request.blockedReason) return false;
      if (request.required) return request.choices[0].value;
      if (request.skillId === "activationRoute") return request.defaultValue;
      const id=request.playerId??request.player?.id;
      const plan=request.activationPlan??game.turn.state?.activationPlan;
      if (request.type==='skillChoice' && game.turn.state?.playerId===id &&
          game.turn.state?.phase==='activation' && plannedSkills.has(request.skillId) && plan?.decisionAware)
        return plan.skillId===request.skillId;
      return policy.chooseAiRuleDecision(request,game);
    },
  };
  return adapted;
}
