// Hand belief support. Card classes use printed traits only.
// Labels are produced by the trusted simulator for training a belief model;
// they are never part of a policy observation.
import { Game } from '../../src/engine.js';

export const classKey = card => `${card.type}:${card.name}:${card.elements.join('+')}`;

// Base deck classes plus one bucket for hero-created exclusive cards.
export const CARD_CLASSES = (() => {
  const game = new Game({ seed: 1 });
  return [...[...new Set([...game.cards.values()].map(classKey))].sort(), 'other'];
})();
const classIndex = new Map(CARD_CLASSES.map((key, index) => [key, index]));
const OTHER = CARD_CLASSES.length - 1;

export const classOf = card => classIndex.get(classKey(card)) ?? OTHER;

// Relative seats 1..5 from the observer, matching observation player entities.
export function handLabels(game, observerId) {
  return [1, 2, 3, 4, 5].map(offset => {
    const counts = new Array(CARD_CLASSES.length).fill(0);
    for (const card of game.player((observerId + offset) % 6).hand) counts[classOf(card)]++;
    return counts;
  });
}

// Class composition of the pool the search resampler deals from (deck plus the
// other players' hands). Used as the prior a belief model must improve on.
export function poolCounts(game, observerId) {
  const counts = new Array(CARD_CLASSES.length).fill(0);
  for (const card of game.deck) counts[classOf(card)]++;
  for (const player of game.players) if (player.id !== observerId) for (const card of player.hand) counts[classOf(card)]++;
  return counts;
}
