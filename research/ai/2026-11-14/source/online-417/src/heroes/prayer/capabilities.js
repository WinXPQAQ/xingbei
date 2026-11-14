export default function capabilities(c) {
  const runes = c.hs.prayerRunes ?? 0;
  const ready = Number(runes > 0 && (Boolean(c.hs.form) || c.gem > 0));
  return {
    spellThreats: [c.threat('darkCurse', 2, ready)],
    discard: { self: ready * Math.min(2, c.count) },
    turnover: { selfDamageDraw: ready * Math.max(0, 2 - c.p.healing) },
    notes: ['诅咒和光辉信仰是互斥的行动选项；未预支未来回合符文。'],
  };
}
