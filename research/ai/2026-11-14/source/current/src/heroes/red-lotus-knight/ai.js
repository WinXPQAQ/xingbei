import {
  selfHealing, selfDamage, healingTargetValue, prayerState, prayerPlan,
  hitPlan, temperancePlan, finishValue,
} from './planning.js';

const energy = player => player.energy.gem + player.energy.crystal;
export const redLotusKnightAi = {
  id: 'redLotusKnight', energyPreference: 'crystal',
  resourceValue: player => (player.heroState.bloodSeals ?? 0) * 5 +
    Math.min(2, energy(player)) * 5 + (player.healing > 0 ? 4 : 0),
  cardBonus: ({ player, card, retained }) => card.type === 'spell' &&
    retained.filter(c => c.type === 'spell').length < 2
      ? (player.hero.state.bloodSeals > 0 && energy(player) > 0 ? 12 : 5) : 0,
  refineBonus({ state, player, crystal }) {
    if (energy(player) >= 2) return 0;
    const preparingSeals = player.heroState.bloodSeals === 1 && player.healing > 0;
    const spells = player.hand.filter(c => c.type === 'spell').length;
    const pressure = state.players.some(p => p.team !== player.team && p.count >= p.limit - 1);
    return (preparingSeals ? 8 : player.healing > 0 || player.heroState.bloodSeals > 0 ? 3 : 0) +
      (preparingSeals && spells >= 2 && pressure ? 4 : 0) + Math.min(2, crystal);
  },
  healingDecision({ state, id, request, context }) {
    if (context.sourceId !== id) return undefined;
    return selfHealing(state, id, context.amount ?? 0, request.choices.map(choice => choice.value));
  },
  afterDamage({ player, moraleLost }) {
    if (moraleLost > 0 && !player.heroState.form) player.heroState.form = 'boilingBlood';
  },
  prepareAttack({ state, id, active }, api) {
    if (!active || state.turn?.usedSkills?.scarletCovenant) return;
    api.heal(state, id, 1);
    if (state.turn) state.turn.usedSkills = { ...state.turn.usedSkills, scarletCovenant: true };
  },
  preparations({ state, id, player, options }, api) {
    for (let count = 1; count <= player.healing; count++) {
      const next = prayerState(state, id, count, api);
      if (next && !api.terminal(next)) options.push({ state: next, activated: 'bloodPrayer' });
    }
    return options;
  },
  attackHitBonus({ game, state, id, targetId, amount, active }, api) {
    if (!active) return 0;
    const plan = hitPlan(game, state, id, targetId, amount, api, { award: true });
    return plan.value - api.evaluate(plan.baseline);
  },
  attackMissBonus({ game, state, id, active }, api) {
    return active ? finishValue(game, state, id, api) - api.evaluate(state) : 0;
  },
  scoreSkill({ game, next, id, targetId, skillId, player }, api) {
    if (skillId !== 'scarletCross') return null;
    player.heroState.bloodSeals--;
    selfDamage(next, id, 4, api);
    if (!api.terminal(next)) api.hurt(next, targetId, 3, 'spell', { sourceId: id });
    return finishValue(game, next, id, api) - api.evaluate(next);
  },
  decisions: {
    scarletCovenant: () => true,
    bloodPrayer({ request, state, id, game }, api) {
      if (request.type === 'playerChoice') return [...request.choices].sort((a, b) =>
        healingTargetValue(state.players[b.value]) - healingTargetValue(state.players[a.value]))[0]?.value ?? request.defaultValue;
      const counts = request.type === 'numberChoice' ? request.choices.map(c => c.value) : null;
      const plan = prayerPlan(game, state, id, api, counts);
      return request.type === 'skillChoice' ? plan.count > 0 : plan.count || request.defaultValue;
    },
    slaughterFeast({ game, state, id, context }, api) {
      return hitPlan(game, state, id, context.targetId, context.amount, api).useFeast;
    },
    temperance({ request, game, id, state }, api) {
      // The action-type prompt occurs after the energy was paid and the form
      // cleared. Do not charge it again when choosing attack versus spell.
      const plan = temperancePlan(game, state, id, api, { paid: request.type !== 'skillChoice' });
      return request.type === 'skillChoice' ? plan.use : plan.mode ?? request.defaultValue;
    },
  },
};
