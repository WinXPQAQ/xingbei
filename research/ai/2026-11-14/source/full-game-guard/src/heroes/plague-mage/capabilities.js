export default function capabilities(c) {
  const group = c.groupCount(), cards = Math.max(2, Math.floor(group));
  return { spellThreats: [
    c.threat('plague', 1, c.chance({ element: 'earth' }), { targets: c.others.map(p => p.id), targetCount: c.others.length, targeting: 'allOthers' }),
    c.threat('toxicNova', 2, c.gemReady, { targets: c.others.map(p => p.id), targetCount: c.others.length, targeting: 'allOthers' }),
    c.threat('deathTouch', Math.max(0, c.p.healing + cards - 3), Number(c.p.healing >= 2) * c.groupChance()),
  ], discard: { self: cards * Number(c.p.healing >= 2) * c.groupChance() },
  notes: ['疫病与毒爆全场包含队友，不只累计敌方收益。'] };
}
