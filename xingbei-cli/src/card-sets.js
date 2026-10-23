// Legal card combinations are shared by the engine, clients and detached AI.
export function combinations(items, count) {
  if (count === 0) return [[]];
  if (count < 0 || count > items.length) return [];
  return items.flatMap((item, index) =>
    combinations(items.slice(index + 1), count - 1).map(rest => [item, ...rest]));
}
export function cardSets(hand, spec) {
  const available = hand.filter(spec.cardFilter ?? (() => true));
  return (spec.cardCounts ?? [spec.cardCount ?? 0])
    .flatMap(count => combinations(available, count))
    .filter(spec.cardsFilter ?? (() => true));
}
export function targetCounts(spec, cardCount) {
  return spec.targetCountsByCardCount?.[cardCount] ?? spec.targetCounts ?? [spec.targetCount ?? 1];
}
export function sameElements(game, playerId, cards) {
  if (!cards.length) return false;
  const sets = cards.map(card => card.getTraits({ game, playerId }).elements);
  return sets[0].some(element => sets.every(set => set.includes(element)));
}
export function distinctElements(game, playerId, cards) {
  const sets = cards.map(card => card.getTraits({ game, playerId }).elements);
  const assign = (index, used) => index === sets.length || sets[index].some(element =>
    !used.has(element) && assign(index + 1, new Set([...used, element])));
  return assign(0, new Set());
}
