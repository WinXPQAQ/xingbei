import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from '../../src/engine.js';
import { buildDecisionSpace, DECISION_MODE_V3 } from '../decision-space.mjs';
import { resolveDecision } from '../decision-runner.mjs';

const sage = 0;
const mode = DECISION_MODE_V3;
function sageGame(cards) {
  const game = new Game({ seed: 17, heroIds: ['sage', 'berserker', 'magicArcher', 'marksman', 'sealer', 'priest'] }).setup();
  for (const card of [...game.player(sage).hand]) game.moveCard(card.id, { zone: 'outside' });
  for (const id of cards) game.moveCard(id, { zone: 'hand', playerId: sage });
  return game;
}

function codex(game, skillId) {
  const root = buildDecisionSpace(game, sage, { type: 'action' }, { mode });
  const route = root.candidates.find(choice => choice.skillId === skillId);
  assert.ok(route);
  return root.next(route);
}

test('Sage V3 packages legal codex fees and complete target selections without merging different card types', async () => {
  // Wind attack, wind spell, earth, water, fire, light.
  const game = sageGame(['c49', 'c140', 'c91', 'c7', 'c28', 'c112']);
  game.gainEnergy(sage, 'gem');
  await game.beginTurn(sage);
  const arcane = codex(game, 'arcaneCodex');
  assert.deepEqual([...new Set(arcane.candidates.map(action => action.cardIds.length))].sort(), [2, 4, 5]);
  assert.ok(arcane.candidates.filter(action => action.cardIds.length === 4).every(action => !action.cardIds.includes('c112')));
  assert.ok(arcane.candidates.some(action => action.cardIds.length === 5 && action.cardIds.includes('c49')));
  assert.ok(arcane.candidates.some(action => action.cardIds.length === 5 && action.cardIds.includes('c140')));
  assert.ok(arcane.candidates.every(action => action.targetIds.length === 1));
  const team = game.player(sage).team;
  assert.ok(arcane.candidates.every(action => action.targetIds[0] === sage || game.player(action.targetIds[0]).team !== team));
  const holy = codex(game, 'holyCodex');
  assert.deepEqual([...new Set(holy.candidates.map(action => action.cardIds.length))].sort(), [4, 5]);
  assert.ok(holy.candidates.some(action => action.cardIds.length === 5 && action.targetIds.length === 3));
  for (const action of holy.candidates) {
    assert.ok(action.targetIds.length > 0 && action.targetIds.length <= action.cardIds.length - 2);
    assert.equal(new Set(action.targetIds).size, action.targetIds.length);
    assert.ok(action.targetIds.every(id => game.player(id).team === team));
  }
  const command = holy.candidates.find(action => action.cardIds.length === 5 && action.targetIds.length === 3);
  assert.deepEqual(holy.next(command).value, command);
  await game.activateAsync(sage);
  await game.executeAction(sage, command);
  assert.equal(game.player(sage).energy.gem, 2); // Holy Codex's 4 self-damage triggers Wisdom Codex.
  assert.equal(game.turn.state.completed, true);
});

test('Sage V3 offers complete rebound sets plus decline and leaves actual target selection to the engine', async () => {
  const game = sageGame(['c28', 'c29', 'c30', 'c7']);
  const request = { type: 'cardChoice', playerId: sage, skillId: 'spellRebound', optional: true,
    valid: [0, 1, 2], validSets: [[0, 1], [0, 2], [1, 2], [0, 1, 2]] };
  const fees = buildDecisionSpace(game, sage, request, { mode });
  assert.deepEqual(fees.candidates, [null, [0, 1], [0, 1, 2]]);
  assert.equal(fees.next(null).value, null);
  assert.deepEqual(fees.next([0, 1, 2]).value, [0, 1, 2]);
  const targetRequest = { type: 'playerChoice', playerId: sage, skillId: 'spellRebound',
    choices: game.players.map(player => ({ value: player.id })) };
  const targets = buildDecisionSpace(game, sage, targetRequest, { mode });
  assert.ok(targets.candidates.includes(sage));
  assert.ok(targets.candidates.every(id => id === sage || game.player(id).team !== game.player(sage).team));
});

test('V3 classifies choices by request ownership and candidate meaning', async () => {
  const game = sageGame(['c49', 'c91', 'c7', 'c28', 'c112']);
  game.gainEnergy(sage, 'gem');
  game.addStones(game.player(sage).team, 'gem', 2);
  await game.beginTurn(sage);
  let mixed = false;
  await resolveDecision(game, sage, { type: 'action' }, ({ request, candidates, v3 }) => {
    assert.equal(v3.hero, 'sage');
    assert.equal(v3.ordinary.length, candidates.length);
    if (request.stage === 'direction') {
      mixed = true;
      assert.ok(candidates.some(candidate => candidate.direction === 'refine'));
      for (const [index, candidate] of candidates.entries())
        assert.equal(v3.ordinary[index], !['refine', 'heroSkill'].includes(candidate.direction));
      return candidates.findIndex(candidate => candidate.skillId === 'arcaneCodex');
    }
    assert.ok(v3.ordinary.every(value => !value));
    return 0;
  }, { mode });
  assert.ok(mixed);
  const healing = { type: 'healing', playerId: sage, skillId: 'arcaneCodex',
    choices: [{ value: 0 }, { value: 1 }] };
  await resolveDecision(game, sage, healing, ({ v3 }) => {
    assert.deepEqual(v3.ordinary, [true, true]);
    return 0;
  }, { mode });
  const discard = { type: 'cardChoice', playerId: sage, valid: [0, 1], count: 1, purpose: 'discard' };
  for (const [request, isOrdinary] of [[discard, true], [{ ...discard, skillId: 'wisdomCodex' }, false]]) {
    await resolveDecision(game, sage, request, ({ v3 }) => {
      assert.deepEqual(v3.ordinary, [isOrdinary, isOrdinary]);
      return 0;
    }, { mode });
  }
  await resolveDecision(game, sage, healing, ({ v3 }) => {
    assert.equal(v3, undefined);
    return 0;
  }, { mode: 'hierarchical-v2' });
});
