export default function capabilities(c) {
  const fire = c.hs.ghostFire ?? 0, pair = c.groupChance('fate');
  return {
    spellThreats: [c.threat('darkRitual', 2, fire >= 3 ? 1 : fire === 2 ? Math.max(pair, c.energyReady) : 0, { targets: c.state.players.map(p => p.id), targeting: 'any', route: 'turnEnd' })],
    discard: { self: 2 * pair, ally: c.energyReady * Number(Boolean(c.hs.form)) * pair },
    turnover: { selfDamageDraw: c.energyReady * Math.max(0, Math.min(3, fire + 1) - c.p.healing) },
    notes: ['同命格组用于进/退形态，生命结界自伤单独记入摸牌能力。'],
  };
}
