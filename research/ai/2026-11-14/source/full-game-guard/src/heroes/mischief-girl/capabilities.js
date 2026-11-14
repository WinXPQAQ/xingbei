export default function capabilities(c) {
  const holders = c.state.players.filter(p => p.effects?.some(e => e.name === 'tricky'));
  const basic = c.state.players.some(p => c.basicEffects(p));
  return {
    spellThreats: [
      c.threat('trickyShot', 2, c.attack * Number(holders.length > 0) * .3, { targets: holders.map(p => p.id), targeting: 'any', route: 'attackMiss' }),
      c.threat('trickOrTreat', 2, holders.length > 4 ? .55 : 0, { targets: holders.map(p => p.id), targetCount: holders.length, targeting: 'allHolders', route: 'turnEnd' }),
    ],
    discard: { self: Math.max(c.chance({ name: 'holyShield' }) * Number(basic), c.energyReady * Math.min(c.count, Math.max(0, 6 - holders.length))) },
    turnover: { exchange: c.chance({ name: 'holyShield' }) * Number(basic), draw: c.energyReady * holders.length },
    notes: ['Tricky暗牌不读取属性；Surprise收取后再放置，收牌与离手分别记录。'],
  };
}
