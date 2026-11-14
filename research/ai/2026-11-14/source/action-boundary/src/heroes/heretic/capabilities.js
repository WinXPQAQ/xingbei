export default function capabilities(c) {
  const covers = Math.max(0, c.p.coveredCount ?? 0), banish = c.energyReady * Number(!c.hs.banishUsed);
  return {
    spellThreats: [c.threat('doomProphecy', 1 + Math.min(4, c.groupCount()), covers > 0 ? .25 / covers : 0, { route: 'prophecyRevealed' })],
    turnover: { draw: banish, exchange: Math.max(6 * banish, (c.hs.damagedEnemies?.length ?? 0) ? 1 : 0) },
    notes: ['不读取预言暗面；放逐的先摸后盖计换牌，不将6张盖牌当净减压。'],
  };
}
