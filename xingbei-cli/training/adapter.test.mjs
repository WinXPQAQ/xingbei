import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/engine.js';
import { actionCandidates, decisionCandidates } from './candidates.mjs';
import { driveGame } from './driver.mjs';

test('refresh does not hide legal refinement; ordinary pass stays illegal', async () => {
  const game = new Game({ seed: 1, heroRules: false }).setup();
  for (const card of [...game.player(0).hand]) game.moveCard(card.id, { zone: 'outside' });
  const lights = [...game.cards.values()].filter(card => card.name === 'holyLight').slice(0, 4);
  assert.equal(lights.length, 4);
  for (const card of lights) game.moveCard(card.id, { zone: 'hand', playerId: 0 });
  game.addStones('red', 'gem', 2);
  await game.beginTurn(0);
  const choices = actionCandidates(game, 0);
  assert.deepEqual(choices, [{ type: 'refresh' }, { type: 'refine', stones: { gem: 1, crystal: 0 } }, { type: 'refine', stones: { gem: 2, crystal: 0 } }]);
  game.turn.state.completed = true;
  game.turn.addAttackAction();
  assert.deepEqual(actionCandidates(game, 0), [{ type: 'pass' }]);
});

test('unknown decisions fail closed; optional card selections retain all combinations', () => {
  assert.throws(() => decisionCandidates(null, { type: 'futureSkill' }), /Unsupported/);
  assert.deepEqual(decisionCandidates(null, { type: 'cardChoice', valid: [0, 2, 3], count: 2, optional: true }), [null, [0, 2], [0, 3], [2, 3]]);
});

test('uniform full six-hero games route asynchronous decisions without legacy fallback', async () => {
  let state = 735923;
  const kinds = new Set();
  for (let i = 0; i < 24; i++) {
    const result = await driveGame({ seed: 210000000 + i, start: i % 6 }, async ({ candidates }) => {
      await Promise.resolve();
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return Math.floor(state / 2 ** 32 * candidates.length);
    });
    assert.equal(result.terminated, true);
    assert.equal(result.truncated, false);
    assert.equal(Object.values(result.rewards).reduce((a, b) => a + b), 0);
    Object.keys(result.kinds).forEach(kind => kinds.add(kind));
  }
  for (const kind of ['action', 'response', 'overflow', 'skillChoice', 'cardChoice', 'weakness', 'energyChoice', 'healing', 'playerChoice', 'numberChoice', 'effectChoice', 'bindingChoice']) assert.ok(kinds.has(kind), kind);
});

test('decision cutoff is a truncation without a fabricated terminal reward', async () => {
  const result = await driveGame({ seed: 210000100, decisionLimit: 1 }, () => 0);
  assert.equal(result.truncated, true);
  assert.equal(result.terminated, false);
  assert.equal(result.rewards, null);
  assert.equal(result.truncationReason, 'decisionLimit');
});
