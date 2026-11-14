export default function capabilities(c) {
  const barriers = c.state.publicBarriers?.find(p => p.id === c.p.id)?.cards ?? [];
  const ritual = c.hs.ritual ?? 0;
  const canGain = ritual < 3 && (barriers.length ? .5 : Number(c.count >= 2));
  return {
    spellThreats: [c.threat('banishingRealm', 1, canGain * c.energyReady, { route: 'ritualGain' })],
    discard: { self: Math.max(barriers.length ? 0 : Math.min(2, c.count), ritual > 0 ? Math.min(1, c.count) : 0), ally: Number(Boolean(c.hs.form)) * .5 },
    notes: ['结界同系攻击增减由公共攻击评分单独处理；此处只评伏魔境法伤和结界离手。'],
  };
}
