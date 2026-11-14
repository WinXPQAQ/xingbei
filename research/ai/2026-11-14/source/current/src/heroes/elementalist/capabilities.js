const uniques = [['meteor', 'earth', 1], ['freeze', 'water', 1], ['fireball', 'fire', 2], ['windBlade', 'wind', 1], ['lightning', 'thunder', 1]];
export default function capabilities(c) {
  const meteor = c.chance({ unique: 'meteor' });
  return {
    spellThreats: [
      ...uniques.map(([skillId, element, amount]) => c.threat(skillId, amount + c.chance({ element }, 2), c.chance({ unique: skillId }), { route: skillId === 'meteor' ? 'extraSpell' : 'action' })),
      c.threat('elementIgnition', 2, c.hs.elements >= 3 ? 1 : c.hs.elements === 2 ? meteor : 0, { route: 'ignitionFollowup' }),
      c.threat('moonlight', c.energy, c.gemReady),
    ],
    discard: { self: Math.max(0, ...uniques.map(([skillId, element]) => 2 * c.chance({ unique: skillId }) * c.chance({ element }, 2))) },
    normalPlay: Math.max(c.attack, c.spell) + meteor,
    notes: ['陨石、点燃、末次法术分开表示；未搜索完整连锁和追加牌的机会成本。'],
  };
}
