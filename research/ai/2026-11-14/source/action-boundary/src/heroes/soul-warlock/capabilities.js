export default function capabilities(c) {
  const yellow = c.hs.yellowSoul ?? 0;
  const ready = Number(yellow >= 3 || (yellow >= 1 && c.gem > 0));
  return {
    spellThreats: [c.threat('soulTreasure', 3, ready * c.chance({ unique: 'soulTreasure' }), {
      amountByTarget: Object.fromEntries(c.enemies.map(p => [p.id, p.count < 3 && p.limit > 5 ? 5 : 3])),
    })],
    discard: { self: Math.max(c.expected({ type: 'spell' }), yellow >= 2 ? Math.min(2, c.count) : 0) },
    turnover: { exchange: yellow >= 2 ? Math.min(2, c.count) : 0 },
    notes: ['灵魂镜像自己弃2摸2计换牌；召回灵魂弃法术计真实离手。'],
  };
}
