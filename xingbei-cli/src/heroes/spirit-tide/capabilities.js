export default function capabilities(c) {
  const base = Math.max(...['holyShield', 'poison', 'weakness'].map(name => c.chance({ name })));
  const special = Math.max(c.chance({ fate: 'H', type: 'attack' }), c.chance({ unique: 'powerBlessing' }), c.chance({ unique: 'speedBlessing' })) * c.energyReady;
  const surge = Number(c.hs.surge ?? 0);
  return {
    spellThreats: [
      c.threat('spiritExorcism', 1, Math.max(base, special), { route: 'effectAttached' }),
      c.threat('ragingTide', 1, surge >= 4 ? 1 : surge === 3 ? .45 : 0, {
        targets: c.state.players.map(p => p.id), targetCount: 4, targeting: 'any', route: 'turnEnd',
        amountByTarget: Object.fromEntries(c.state.players.map(p => [p.id, 1 + c.basicEffects(p)])),
      }),
    ],
    discard: { self: 2 * special },
    notes: ['怒潮将敌我四个目标一起评估；未假设回响之灵必然触发。'],
  };
}
