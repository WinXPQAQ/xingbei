export default function capabilities(c) {
  // The exclusive book is not in the printed deck. Other seats see no hand
  // identity, so the unknown-hand case retains an explicitly uncertain option.
  const book = c.known.some(card => card.name === 'chronicle') ? 1 : c.unknown ? .25 : 0;
  return {
    spellThreats: [c.threat('myriadRuins', 2, book * .45, { targetCount: 2 })],
    discard: { self: Number(c.count > 0) },
    turnover: { exchange: c.energyReady * Math.min(2, c.count), draw: c.energyReady * Math.max(0, (c.p.coveredCount ?? 0) - 2) },
    notes: ['秘境万象要继续翻牌，未读取未来牌序；史书暗手牌仅保留不确定机会。'],
  };
}
