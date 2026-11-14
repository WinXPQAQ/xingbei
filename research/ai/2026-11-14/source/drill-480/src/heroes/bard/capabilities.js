export default function capabilities(c) {
  const inspiration = c.hs.inspiration ?? 0, n = inspiration >= 2 ? Math.min(3, inspiration) - 1 : 0;
  const holder = c.state.players.find(p => p.skillIds?.includes('passionateRhapsody') || p.effects?.some(e => e.name === 'eternalMovement'));
  return {
    spellThreats: [
      c.threat('sinkingConcerto', 1, !c.hs.form && !c.hs.concertoUsed ? c.groupChance() * c.spell * .2 : 0, { route: 'teamSpellFollowup' }),
      c.threat('passionateRhapsody', 1, Number(Boolean(holder)), { targetCount: 2, route: 'movementActivation' }),
    ],
    discard: { self: Math.max(n * 2, c.energyReady * Number(Boolean(holder)), c.groupChance() * .4), ally: n },
    turnover: { draw: Math.max(n * 2, c.energyReady), selfDamageDraw: inspiration >= 3 && holder ? Math.max(0, 3 - c.p.healing) * .5 : 0 },
    notes: ['不谐和弦可选自身两次；弃牌与摸牌是不同选项，并非同时发生。'],
  };
}
