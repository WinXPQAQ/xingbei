import test from 'node:test';
import assert from 'node:assert/strict';
import { firstSageRefinement, removeExerciseObjective } from './sage-transfer.mjs';

test('refinement intervention uses an existing legal choice once and only for empty-energy Sage', () => {
  const player = { hero: {id: 'sage'}, energy: {gem: 0, crystal: 0}, team: 'red' };
  const game = { player: () => player, canRefine: () => true, getEnergyLimit: () => 3, stoneCounts: () => ({gem: 2}) };
  const state = {refined: false, decisions: 0};
  const input = {game, playerId: 0, request: {type: 'action'}, candidates: [{direction: 'attack'}, {direction: 'refine'}]};
  assert.equal(firstSageRefinement(input, state), 1);
  player.energy.crystal = 1;
  assert.equal(firstSageRefinement(input, state), null);
  player.energy.crystal = 0;
  input.candidates = [{type: 'refine', stones: {gem: 1, crystal: 1}}, {type: 'refine', stones: {gem: 2, crystal: 0}}];
  assert.equal(firstSageRefinement(input, state), 1);
  assert.equal(firstSageRefinement(input, state), null);
  assert.equal(state.decisions, 2);
  assert.deepEqual(player.energy, {gem: 0, crystal: 0});
});

test('practice-marker ablation preserves game information and all candidate identities', () => {
  const observation = {question: 0, entities: [{categorical: {skill: 'spellRebound', objective: 'enemyMoraleLoss'}, numbers: {amount: 1, initialGems: 1, maxOwnMoraleLoss: 0}}], candidates: [{id: 4}, {id: 9}]};
  removeExerciseObjective(observation);
  assert.deepEqual(observation.entities[0], {categorical: {skill: 'spellRebound'}, numbers: {amount: 1}});
  assert.deepEqual(observation.candidates, [{id: 4}, {id: 9}]);
});
