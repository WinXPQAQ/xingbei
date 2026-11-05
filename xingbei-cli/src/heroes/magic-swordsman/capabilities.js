export default function capabilities(c) {
  const meteor = c.chance({ type: 'spell' }, 2);
  return { basicMagic: false,
    spellThreats: [c.threat('shadowMeteor', 2, meteor)],
    discard: { self: 2 * meteor },
    turnover: { selfDamageDraw: Math.max(0, 1 - c.p.healing), exchange: 2 * c.gemReady * c.attack * .45 },
    normalPlay: c.attack + c.attack * c.chance({ type: 'attack', element: 'fire' }) * .5,
    notes: ['允许启动进入暗影再用暗影流星；冥王震颤补满再弃属于换牌，不算纯减压。'],
  };
}
