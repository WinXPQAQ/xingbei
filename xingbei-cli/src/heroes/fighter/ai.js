export const fighterAi = {
  id: 'fighter', acceptsRefine: () => true,
  resourceValue: p => (p.heroState.spirit ?? 0) * 2 + (p.heroState.form ? 4 : 0),
  attackDamage: ({ player, active }) => player.heroState.form ? active ? 2 : 1 : 0,
  cardBonus: ({ card }) => card.type === 'attack' ? 8 : -6,
  decisions: {
    chargedStrike: ({ player, context }) => player.count + Math.min(4, player.heroState.spirit + 1) <= player.limit || context.targetHandCount >= 5,
    stunningBlow: ({ player, context }) => context.canCounter !== false && player.count + Math.min(4, player.heroState.spirit - 1) <= player.limit,
    hundredDragonFist: ({ game, id }) => game.player(id).hand.some(c => c.type === 'attack'),
    warGodBody: ({ player, request }) => request.type === 'skillChoice' ? player.count >= 5 && player.healing < player.healingLimit : undefined,
    spiritBullet({ state, id, player, request }, { damageGain }) {
      const enemies = state.players.filter(p => p.team !== player.team);
      const best = enemies.map(p => ({ id: p.id, gain: damageGain(state, id, p.id, 1) + (p.healing ? 0 : damageGain(state, id, id, Math.min(4, player.heroState.spirit + 1))) })).sort((a,b) => b.gain-a.gain)[0];
      return request.type === 'skillChoice' ? best.gain > 0 : best.id;
    },
  },
};
