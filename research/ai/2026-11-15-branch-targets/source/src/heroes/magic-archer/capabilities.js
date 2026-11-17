export default function capabilities(c) {
  const covers = Math.max(0, c.p.coveredCount ?? 0), thunder = 1 - .85 ** covers;
  const open = c.enemies.filter(p => p.count < p.limit).map(p => p.id);
  return {
    spellThreats: [
      c.threat('thunderScatter', 1, Number(!c.hs.charged) * thunder, { targets: c.enemies.map(p => p.id), targetCount: c.enemies.length, targeting: 'enemyTeam' }),
      c.threat('pierce', 3, Number(!c.hs.charged && !c.hs.pierceUsed) * (1 - .85 ** covers) * c.attack * .4, { targets: open, route: 'attackMiss' }),
    ],
    discard: { self: c.energyReady * Math.max(0, c.count - 4), enemy: c.gemReady },
    turnover: { draw: Math.max(c.gemReady * 3, c.energyReady * Math.min(4, Math.max(0, c.p.limit - Math.min(4, c.count)))), exchange: c.energyReady * Math.min(4, c.count) },
    notes: ['盖牌只用公开数量与印刷牌分布，未窥探雷/火盖牌；散射暂按群体1点保守估计。'],
  };
}
