import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from '../src/engine.js';
import { PublicHandMemory } from './public-hand-memory.mjs';
import { resampleHidden } from './driver.mjs';

function fixture() {
  const g = new Game({ seed: 17, heroRules: false });
  g.publicHandMemory = new PublicHandMemory();
  return g.setup();
}

test('shown cards survive sampling and a public gift; an open discard ends the constraint', () => {
  for (let seed = 0; seed < 24; seed++) {
    const g = fixture();
    const p = g.player(1), card = p.hand[0], own = [...g.player(0).hand];
    const sizes = g.players.map(p => p.hand.length);
    g.showCardsSteps(1, [card]).next();
    resampleHidden(g, 0, seed);
    assert.ok(p.hand.includes(card));
    assert.deepEqual(g.players.map(p => p.hand.length), sizes);
    assert.deepEqual(g.player(0).hand, own);
    g.giveCards(1, 2, [card], { visibility: 'public' });
    resampleHidden(g, 0, seed + 100);
    assert.ok(g.player(2).hand.includes(card));
    g.discardCard(g.player(2), g.player(2).hand.indexOf(card));
    assert.ok(!g.publicHandMemory.knows(2, card));
    assert.ok(g.publicHandMemory.events.some(e => e.reason === 'show' && e.cardId === card.id));
  }
});

test('secret departure of shown vs unshown card gives the same public memory', () => {
  const records = [0, 1].map(index => {
    const g = fixture(), p = g.player(1), card = p.hand[0];
    g.showCardsSteps(1, [card]).next();
    g.draw(1, 1);
    assert.ok(g.publicHandMemory.knows(1, card));
    g.discardCard(p, index, { visibility: 'hidden' });
    assert.ok(!g.publicHandMemory.knows(1, card));
    return g.publicHandMemory.events;
  });
  assert.deepEqual(records[0], records[1]);
  assert.equal(records[0].at(-1).type, 'unknownDeparture');
});

test('same public facts and sample seed give the same deal across hidden hand/deck permutations', () => {
  const deals = [false, true].map(swap => {
    const g = fixture(), p = g.player(1);
    g.showCardsSteps(1, [p.hand[0]]).next();
    if (swap) {
      const handCard = p.hand[1], deckCard = g.deck[0];
      g.moveCard(handCard.id, { zone: 'deck' });
      g.moveCard(deckCard.id, { zone: 'hand', playerId: 1 });
      // The swap constructs an alternative initial hidden deal, not an observed move.
      g.publicHandMemory = new PublicHandMemory();
      g.showCardsSteps(1, [p.hand[0]]).next();
      g.deck.reverse();
    }
    resampleHidden(g, 0, 9876);
    return [g.deck, ...g.players.map(p => p.hand)].map(cards => cards.map(c => c.id));
  });
  assert.deepEqual(deals[0], deals[1]);
});
