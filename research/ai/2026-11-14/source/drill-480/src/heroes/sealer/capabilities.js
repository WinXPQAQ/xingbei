export default function capabilities(c) {
  const seal = c.chance({ type: 'attack', fate: 'H' });
  return {
    spellThreats: [c.threat('elementSeal', 3, seal * .4, { delayed: true })],
    normalPlay: Math.max(c.attack, c.spell, seal) + c.attack * Math.max(c.spell, seal),
    turnover: { draw: c.energyReady * Number(c.state.players.some(p => c.basicEffects(p))) },
    notes: ['封印触发取决于后续公开用牌；法接攻击按当前手牌机会估计。'],
  };
}
