export default function capabilities(c) {
  return {
    spellThreats: [
      c.threat('flashTrap', 2, c.chance({ unique: 'flashTrap' })),
      c.threat('piercingShot', 2, c.attack * c.spell * .45, { route: 'attackMiss' }),
    ],
    drawThreats: [c.threat('snipe', 0, c.energyReady, { amountByTarget: Object.fromEntries(c.enemies.map(p => [p.id, Math.max(0, 5 - p.count)])) })],
    discard: { self: c.attack * c.spell * .45 },
    turnover: { draw: c.energyReady * Math.max(0, 5 - c.count) },
    notes: ['狙击是非伤害补牌，不扣治疗；贯穿需要攻击未命中。'],
  };
}
