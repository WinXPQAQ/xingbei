export const magicLancerAi = {
  id: 'magicLancer', acceptsRefine: () => true,
  cardBonus: ({ card, elements, same }) => card.type === 'spell' ? 5 : elements.includes('thunder') && !same ? 16 : 0,
  attackDamage: ({ player }) => player.heroState.attackBonus ?? 0,
  resourceValue: p => p.energy.crystal * 3,
  scoreSkill({ next, player, skillId, id }, { discardEstimate, bestAttackScore, game }) {
    if (skillId !== 'abundance') return null;
    for (const p of next.players) if (p.team !== player.team) discardEstimate(next, p.id, 1);
    return player.hand.some(c => c.type === 'attack') ? 5 : -20;
  },
  decisions: {
    darkRelease: ({ game, id, player }) => player.count <= 5 && game.player(id).hand.some(c => c.type === 'attack'),
    phantomStars({ state, id, player, request }, { damageGain }) {
      const best = state.players.filter(p => p.team !== player.team).sort((a,b) => damageGain(state,id,b.id,2)-damageGain(state,id,a.id,2))[0];
      return request.type === 'skillChoice' ? player.count + 2 <= player.limit : best.id;
    },
    darkBarrier({ request, source, player, context }, { lowCards }) {
      if (request.type === 'cardChoice') return [...request.valid].sort((a,b)=>Number(source.hand[a].type!=="spell")-Number(source.hand[b].type!=="spell")).slice(0, request.count);
      if (request.choices?.some(c => c.value === 'skip')) {
        const type = source.hand.some(c => c.type === 'spell') ? 'spell' : 'thunder';
        return player.count + (context.amount ?? 0) > player.limit ? type : 'skip';
      }
      return Math.max(1, Math.min(request.choices.length, player.count + (context.amount ?? 0) - player.limit));
    },
    pitchBlackLance({ request, state, id, context }, { damageGain }) {
      let best = { n: 0, score: 0 };
      for (const c of request.choices) if (c.value) {
        const score = damageGain(state,id,context.targetId,context.amount+c.value+2,'attack')-damageGain(state,id,context.targetId,context.amount,'attack')-c.value*4;
        if (score > best.score) best = { n:c.value, score };
      }
      return best.n;
    },
    abundance: ({ request, source }) => request.optional ? null : request.defaultValue,
  },
};
