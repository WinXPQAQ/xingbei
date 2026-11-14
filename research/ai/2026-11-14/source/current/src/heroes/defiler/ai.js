import { formPreference, preferredMalice, prepareTwisted, pollutionComparison, ragingRisk, twistedMode } from './ai-form.js';

function crystalConversionReady({ state, player }) {
  if (player.energy.gem || !player.heroState.form) return false;
  if (player.heroState.malice === 0) return true;
  // With one malice left, an available profitable empowered attack can finish
  // the form on the following ordinary turn. Do not reserve a crystal for a
  // distant, unprepared conversion.
  return player.heroState.malice === 1 && player.hand.some(c => c.type === "attack") &&
    state.players.some(p => p.team !== player.team && (p.healing > 0 || p.count + 3 >= p.limit));
}
export const defilerAi = {
  id: "defiler",
  activationStateFields: ['form', 'malice'],
  energyPreference: "gem",
  usefulCrystals: context => crystalConversionReady(context) ? 1 : 0,
  cardBonus: ({ card, player, retained }) => {
    if (card.type === 'attack') return 10;
    if (!player.hero.state.form || !['poison', 'magicBullet'].includes(card.name)) return 0;
    return retained.some(other => other.name === card.name) ? 3 : 18;
  },
  resourceValue: (p) =>
    (p.heroState.malice ?? 0) * .75,
  prepareAttack({ state, player, targetId }) {
    player.heroState.attackHealingBonus = Number(state.players[targetId].healing > 0);
  },
  attackDamage: ({ player }) => Number(Boolean(player.heroState.form)) + (player.heroState.attackHealingBonus ?? 0),
  attackHitBonus({ state, id, targetId, amount }, api) {
    return Math.max(0, pollutionComparison(state, id, targetId, amount, 'attack', api).gain);
  },
  refineBonus: context => (context.gem && !context.player.energy.gem ? 5 : 0) +
    (context.crystal && !context.player.energy.crystal && crystalConversionReady(context) ? 4 : 0),
  actionBonus({ state, id, player, action }, api) {
    const card = action.type === 'play' ? player.hand[action.index] : null;
    if (!card) return 0;
    let score = card.type === 'attack' ? 3 : 0;
    if (['poison','magicBullet'].includes(card.name)) {
      const targetId=action.targetId, target=state.players[targetId], base=card.name==='poison'?1:2;
      if (target?.team !== player.team) {
        const amount=base+Number(Boolean(player.heroState.form))+Number(target.healing>0);
        score+=(api.damageGain(state,id,targetId,amount,'spell')-api.damageGain(state,id,targetId,base,'spell'))*(card.name==='poison'?.35:.55);
      }
    }
    if (player.heroState.form) score-=ragingRisk(state,id,player.heroState.malice)*3;
    return score;
  },
  preparations({ state, id, player, card, options }, api) {
    if (!player.energy.gem || !card) return options;
    for (const form of [null,'raging']) {
      const prepared=prepareTwisted(state,id,form,api,{keepId:card.id});
      if (prepared.state.players[id].hand.some(c=>c.id===card.id)) options.push(prepared);
    }
    return options;
  },
  decisions: {
    maliceSurge({ game, state, id, player }, api) {
      if (!player.hand.some(card=>card.type==='attack')) return false;
      const follow=api.bestAttackScore(game,id,state).score;
      const forcedForm=player.heroState.malice===1?ragingRisk(state,id,2)*7:0;
      return follow>Math.max(0,forcedForm);
    },
    ragingHeartTarget: ({ request, state, player }) =>
      [...request.choices].sort((a, b) => {
        const score = (id) =>
          (state.players[id].team === player.team ? -1 : 1) *
          state.players[id].healing;
        return score(b.value) - score(a.value);
      })[0].value,
    mindPollution: ({ context, state, id }, api) =>
      pollutionComparison(state,id,context.targetId,context.amount,context.damageType??'spell',api).gain>0,
    twistedLove({ state, id, player, request }, api) {
      if (player.energy.gem <= (request.reservedEnergy ?? 0)) return false;
      const base=api.evaluate(state);
      return [null,'raging'].some(form=>{
        const option=prepareTwisted(state,id,form,api);
        const offense=form?formPreference(option.state,id,api):0;
        return api.evaluate(option.state)+offense>base+1;
      });
    },
    twistedForm: ({ state, id }, api) => formPreference(state,id,api)>0?'raging':null,
    twistedCards: ({ game, state, id, request }, api) => twistedMode(state,id,api,{
      allowDiscard:request.choices.some(c=>c.value==='discard'),
      keepId:(request.reservedCardIds??game.turn.state?.reservedCardIds??[])[0]??null,
    }).mode,
    twistedMalice: ({ state, id }) => preferredMalice(state,id),
  },
};
