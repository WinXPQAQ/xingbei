export default function capabilities(c) {
  return {
    spellThreats: [
      c.threat('magicFusion', 2, Math.max(c.chance({ element: 'earth' }), c.chance({ element: 'fire' })), { targets: c.relayTargets, shieldable: true, responseKind: 'magic' }),
      c.threat('magicBurst', 2, c.spell * .6, { targetCount: 2 }),
      c.threat('destructionStorm', 2, c.gemReady, { targetCount: 2 }),
    ],
    discard: { self: c.spell * Math.min(3, c.count) * .6, enemy: c.spell },
    notes: ['魔爆允许目标弃法术免伤，因此伤害机会折扣；毁灭风暴没有这项弃牌抵消。'],
  };
}
