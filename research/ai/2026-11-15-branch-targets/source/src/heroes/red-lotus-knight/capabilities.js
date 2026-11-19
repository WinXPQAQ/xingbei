export default function capabilities(c) {
  const seal = Number((c.hs.bloodSeals ?? 0) > 0 || c.p.healing > 0);
  const cross = c.energyReady * seal * c.chance({ type: 'spell' }, 2);
  return {
    spellThreats: [c.threat('scarletCross', 3, cross)],
    discard: { self: 2 * cross },
    turnover: { selfDamageDraw: Math.max(c.p.healing, seal * c.attack * 4 * .5, cross * 4) },
    notes: ['血腥祷言和杀戮盛宴提供高摸牌吞吐，绝不折算成弃牌减压；猩红十字需先自伤存活。'],
  };
}
