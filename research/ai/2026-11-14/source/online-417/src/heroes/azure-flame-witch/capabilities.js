import {fireReadiness} from './fire-forecast.js';

export default function capabilities(c) {
  const fire = fireReadiness(c.known,c.unknown,c.p.id,c.hs.form,1), pair = fireReadiness(c.known,c.unknown,c.p.id,c.hs.form,2);
  const burst = Number(Boolean(c.hs.form) || (c.hs.rebirth ?? 0) > 0);
  const morale = c.state.teams?.[c.p.team]?.morale ?? 15;
  return {
    spellThreats: [
      c.threat('azureCodex', 2, fire),
      c.threat('skyfireRift', 3, pair * burst, { amountByTarget: Object.fromEntries(c.enemies.map(p => [p.id, 3 + Number(morale < (c.state.teams?.[p.team]?.morale ?? 15))])) }),
      c.threat('painLink', 1, c.energyReady),
      c.threat('manaInversion', Math.max(1, c.expected({ type: 'spell' }) - 1), c.energyReady * c.chance({ type: 'spell' }, 2) * .3, { route: 'spellResponse' }),
    ],
    discard: { self: Math.max(fire, pair * burst * 2, c.energyReady * Math.max(0, c.count - 3)), ally: 0 },
    turnover: { draw: !c.hs.form && c.count < 4 ? 2 : 0, selfDamageDraw: Math.max(fire * Math.max(0,2-c.p.healing), pair * burst * Math.max(0,3-c.p.healing)) },
    notes: ['法典先打目标再自伤；烈焰下未知攻击牌按变火后的印刷分布估计。自伤摸牌不是弃牌或净减压。'],
  };
}
