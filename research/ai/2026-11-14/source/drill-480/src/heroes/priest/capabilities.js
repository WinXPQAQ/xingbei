export default function capabilities(c) {
  return {
    spellThreats: [c.threat('sacredDomain', 2, c.energyReady * Number(c.p.healing > 0 && c.count >= 2))],
    discard: { self: Math.max(2 * c.chance({ type: 'spell' }, 2), Math.min(2, c.count) * c.chance({ element: 'water' }), c.energyReady * Math.min(2, c.count)) },
    notes: ['水之神力的交牌也降低自身手牌；神官水牌不假设独有技标签。'],
  };
}
