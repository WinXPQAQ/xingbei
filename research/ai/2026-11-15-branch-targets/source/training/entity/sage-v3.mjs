// Training-only restrictions on Sage's compound choices. Every command is a
// complete fee/target selection from the engine's current legal action spec.
import { cardSets, combinations, distinctElements, orderedSelections, targetCounts } from '../../src/card-sets.js';

const elementsOf = (game, playerId, card) => card.getTraits({ game, playerId }).elements;
const isLightOrDark = (game, playerId, card) =>
  elementsOf(game, playerId, card).some(element => element === 'light' || element === 'dark');

function codexFees(game, playerId, hand, minimum, spec) {
  return cardSets(hand, spec ?? {
    cardCounts: Array.from({ length: Math.max(0, Math.min(7, hand.length) - minimum + 1) }, (_, index) => index + minimum),
    cardsFilter: cards => distinctElements(game, playerId, cards),
  });
}

export function arcaneOptions(game, playerId, hand, spec) {
  const sets = codexFees(game, playerId, hand, 2, spec);
  const maximum = Math.max(0, ...sets.map(cards => cards.length));
  const maximumSets = sets.filter(cards => cards.length === maximum);
  const keepsProtection = cards => maximumSets.some(full => cards.every(card => full.includes(card)) &&
    full.some(card => !cards.includes(card) && isLightOrDark(game, playerId, card)));
  return sets.filter(cards => cards.length === 2 || cards.length === maximum ||
    (cards.length === maximum - 1 && keepsProtection(cards)))
    .map(cards => ({ x: cards.length, cards }));
}

export function holyOptions(game, playerId, hand, spec) {
  const sets = codexFees(game, playerId, hand, 3, spec);
  const maximum = Math.max(0, ...sets.map(cards => cards.length));
  return sets.filter(cards => maximum === 3 || cards.length === 4 || cards.length === 5)
    .map(cards => ({ x: cards.length, cards }));
}

function reboundGroups(game, playerId, hand) {
  const groups = new Map();
  for (const card of hand) for (const element of elementsOf(game, playerId, card)) {
    if (!groups.has(element)) groups.set(element, []);
    groups.get(element).push(card);
  }
  return groups;
}

export function reboundOptions(game, playerId, hand) {
  const options = [{ skip: true }];
  for (const [element, cards] of reboundGroups(game, playerId, hand)) {
    if (cards.length < 2) continue;
    options.push({ element, x: cards.length, cards });
    if (cards.length > 2)
      for (const pair of combinations(cards, 2)) options.push({ element, x: 2, cards: pair });
  }
  return options;
}

const selfOrEnemies = (game, player) => game.players
  .filter(other => other.id === player.id || other.team !== player.team).map(other => other.id);
export const SAGE_TARGETS = {
  arcaneCodex: selfOrEnemies,
  holyCodex: (game, player) => game.players.filter(other => other.team === player.team).map(other => other.id),
  spellRebound: selfOrEnemies,
};

function distinctSets(sets, equivalentCard) {
  const seen = new Set();
  return sets.filter(cards => {
    const key = JSON.stringify(cards.map(equivalentCard).sort());
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function sageCodexActions(game, playerId, skillId, spec, equivalentCard) {
  const player = game.player(playerId);
  const options = skillId === 'arcaneCodex' ? arcaneOptions : holyOptions;
  const costs = distinctSets(options(game, playerId, player.hand, spec).map(option => option.cards), equivalentCard);
  const allowed = SAGE_TARGETS[skillId](game, player);
  const targets = (spec.targets ?? []).filter(id => allowed.includes(id));
  return costs.flatMap(cards => {
    const count = cards.length;
    const cardIds = cards.map(card => card.id);
    const targetOrders = targetCounts(spec, count).flatMap(size => orderedSelections(targets, size));
    return targetOrders.map(targetIds => ({ type: 'skill', skillId, cardIds, targetIds }));
  });
}

export function sageReboundFees(game, playerId, request, equivalentCard) {
  const hand = game.player(playerId).hand;
  const allowed = new Set(reboundOptions(game, playerId, hand).filter(option => !option.skip)
    .map(({ cards }) => JSON.stringify(cards.map(card => hand.indexOf(card)).sort((a, b) => a - b))));
  // The engine can place additional restrictions on the actual request. Its
  // validSets are authoritative, even when a candidate meets the V3 heuristic.
  const sets = request.validSets.filter(indexes => allowed.has(JSON.stringify([...indexes].sort((a, b) => a - b))));
  const legal = distinctSets((sets.length ? sets : request.validSets).map(indexes => indexes.map(index => hand[index])), equivalentCard)
    .map(cards => cards.map(card => hand.indexOf(card)));
  return request.optional ? [null, ...legal] : legal;
}
