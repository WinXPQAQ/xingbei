import { capabilityElements } from '../shared/ai/capabilities.js';
export default function capabilities(c) {
  const distinct = capabilityElements.reduce((sum, element) => sum + c.chance({ element }), 0);
  const group = c.groupCount();
  return {
    spellThreats: [
      c.threat('arcaneCodex', Math.max(0, distinct - 1), c.gemReady * Number(c.count >= 2)),
      c.threat('spellRebound', Math.max(1, group - 1), c.groupChance() * .3, { route: 'oneSpellDamageResponse' }),
    ],
    discard: { self: c.gemReady * distinct },
    turnover: { selfDamageDraw: Math.max(c.gemReady * Math.max(0, distinct - 1), c.groupChance() * group * .3) },
    notes: ['法典需异系牌组；反弹需要实际承受恰好1法伤，机会有折扣。'],
  };
}
