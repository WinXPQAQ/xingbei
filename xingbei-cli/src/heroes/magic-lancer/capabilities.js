export default function capabilities(c) {
  const barrier = Math.max(c.expected({ type: 'spell' }), c.expected({ element: 'thunder' }));
  const need = Math.max(0, c.count + Math.max(0, 2 - c.p.healing) - c.p.limit);
  const safe = need ? Math.max(c.chance({ type: 'spell' }, need), c.chance({ element: 'thunder' }, need)) : 1;
  return {
    spellThreats: [c.threat('phantomStars', 2, Number(Boolean(c.hs.form)) * safe, { route: 'activation' })],
    discard: { self: barrier },
    turnover: { selfDamageDraw: c.hs.form ? Math.max(0, 2 - c.p.healing) : 0 },
    notes: ['暗之障壁只取法术或雷的较大组，不混用；幻影星辰需先自伤且不损士气才能打出2法伤。'],
  };
}
