import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/engine.js';
import { actionCandidates, decisionCandidates } from './candidates.mjs';
import { encodeDecision } from './observation.mjs';
import { prepare } from './diagnostics.mjs';
import { enrichPreview } from './preview.mjs';

test('bounded refinement and overflow projections match real rules without predicting hidden draws', async () => {
  const game = new Game({ seed: 251000090 }).setup();
  game.addStones('red', 'gem', 2);
  game.addStones('red', 'crystal', 2);
  await game.beginTurn(0);
  const candidates = actionCandidates(game, 0);
  const observation = encodeDecision({ game, playerId: 0, request: { type: 'action' }, candidates });
  const index = candidates.findIndex(c => c.type === 'refine' && c.stones.gem === 1 && c.stones.crystal === 1);
  assert.ok(index >= 0);
  const preview = enrichPreview(observation).candidates[index].preview;
  await game.executeAction(0, candidates[index]);
  assert.deepEqual(game.player(0).energy, preview.energyAfter);
  assert.equal(game.stoneCounts('red').gem, preview.teamStonesAfter.gem);
  assert.equal(game.stoneCounts('red').crystal, preview.teamStonesAfter.crystal);
  const player = game.player(0);
  player.handLimit = 2;
  const request = { type: 'overflow', player };
  const choices = decisionCandidates(game, request);
  const result = enrichPreview(encodeDecision({ game, playerId: 0, request, candidates: choices }));
  const remaining = result.candidates[0].preview.remainingHand;
  game.resolveOverflow(0, choices[0]);
  assert.deepEqual(player.hand.map(card => card.name), remaining.map(card => card.name));
  assert.equal(player.hand.length, result.candidates[0].preview.handCountAfter);
  game.assertCardLocations();
  assert.ok(observation.candidates.filter(c => c.type === 'play').every(c => c.preview.scope === 'unresolved'));
});


test('response projection matches the actual card-to-field checkpoint', () => {
  for (const reverse of [false, true]) {
    const { game, request, steps } = prepare(true, reverse);
    const candidates = decisionCandidates(game, request);
    const original = encodeDecision({ game, playerId: 0, request, candidates });
    const observation = enrichPreview(structuredClone(original));
    const chosen = 1;
    const card = game.player(0).hand[candidates[chosen].index];
    const before = game.player(0).hand.length;
    assert.equal(game.player(0).hand.length, before);
    const step = steps.next(candidates[chosen]);
    assert.ok(['presentation', 'response'].includes(step.value.type));
    assert.equal(card.location.zone, 'field');
    assert.deepEqual(game.player(0).hand.map(c => c.name), observation.candidates[chosen].preview.remainingHand.map(c => c.name));
    assert.equal(observation.candidates[0].preview.scope, 'unresolved');
    assert.ok(!('preview' in original.candidates[chosen]));
  }
});
