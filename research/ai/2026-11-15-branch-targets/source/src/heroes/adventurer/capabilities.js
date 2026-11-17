export default function capabilities(c) {
  return { discard: { self: 2 * c.groupChance() + c.groupChance('element', 3) },
    normalPlay: Math.max(c.attack, c.spell) * (1 + c.energyReady * .5),
    notes: ['骗术按同系牌组机会计算离手能力；偷天换日的额外行动为折扣机会。'] };
}
