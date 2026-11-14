// Project successful prescribed openings onto the unchanged real action tree.
// These are fallible actor references, never terminal team reward labels.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { makeSageDrill, SAGE_DRILL } from './sage-drill.mjs';
import { createEntityEncoder } from './observation.mjs';
import { resolveDecision } from '../decision-runner.mjs';

export async function projectSageOpening(result) {
  if (result.exercise !== SAGE_DRILL || !result.eligible || !result.feasible || result.truncated) return [];
  const opening = result.trace.find(step => step.type === 'action' && step.skillId === 'arcaneCodex');
  if (!opening) throw new Error('Missing prescribed opening');
  const command = opening.candidates[opening.index];
  const game = makeSageDrill(result.seed, SAGE_DRILL);
  const rows = [];
  const encode = createEntityEncoder();
  let cursor = result.trace.indexOf(opening) + 1;
  let responseSequence = 2;
  async function respond(request) {
    const playerId = request.playerId ?? request.player?.id;
    if (playerId !== 0) {
      assert.equal(request.type, 'overflow');
      const indices = Array.from({length: game.player(playerId).hand.length - game.player(playerId).handLimit}, (_, i) => i);
      return game.resolveOverflowWithDecisions(playerId, indices, responseOptions);
    }
    const sequence = responseSequence++;
    const value = await resolveDecision(game, 0, request, input => {
      // The prescribed drill supplies these hits without a healing question.
      // Teach that choice through the actual optional healing interface too.
      const openingHealing = request.type === 'healing' && request.context?.skillId === 'arcaneCodex' && request.context.amount === 1;
      let chosen;
      if (openingHealing) chosen = 0;
      else {
        const original = result.trace[cursor++];
        assert.equal(original.type, input.request.type);
        assert.equal(original.stage, input.request.stage);
        chosen = original.candidates[original.index];
      }
      const choice = input.candidates.findIndex(candidate => JSON.stringify(candidate) === JSON.stringify(chosen));
      assert(choice >= 0, 'Recorded response must remain legal with all options exposed');
      rows.push({gameId: `sage-opening-${result.seed}`, sequence, observation: encode(input), choice});
      return choice;
    });
    if (request.type === 'overflow' && !request.resolveInternally) {
      return game.resolveOverflowWithDecisions(playerId, value, responseOptions);
    }
    return value;
  }
  const responseOptions = {overflow: 'defer', choose: respond, chooseResponse: respond, chooseTarget: respond, resolveOverflow: respond};
  const options = {choose: request => game.automaticDecision(request)};
  await game.beginTurn(0, options, options);
  for (let sequence = 0; sequence < 2; sequence++) {
    const action = await resolveDecision(game, 0, {type: 'action'}, input => {
      const choice = input.teacherIndex(command);
      rows.push({gameId: `sage-opening-${result.seed}`, sequence,
        observation: encode(input), choice});
      return choice;
    });
    if (action.type === 'activate') {
      await game.activateAsync(0, {...options, intent: action.intent});
      continue;
    }
    assert.deepEqual(new Set(action.cardIds), new Set(command.cardIds));
    assert.equal(action.skillId, command.skillId);
    assert.deepEqual(action.targetIds, command.targetIds);
    await game.executeAction(0, action, responseOptions);
    assert.equal(cursor, result.trace.length);
    assert.equal(game.teams.red.morale, result.final.ownMorale);
    assert.equal(game.teams.blue.morale, result.final.enemyMorale);
    return rows;
  }
  throw new Error('Opening projection failed to reach its complete action');
}

if (process.argv[1]?.endsWith('/sage-opening-reference.mjs')) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: sage-opening-reference.mjs DRILL_RESULTS.json OUTPUT.jsonl');
  const results = JSON.parse(fs.readFileSync(input, 'utf8')).results;
  const rows = [];
  for (const result of results) rows.push(...await projectSageOpening(result));
  fs.writeFileSync(output, rows.map(row => JSON.stringify(row)).join('\n') + '\n', {flag: 'wx'});
  console.log(JSON.stringify({games: results.length, decisions: rows.length}));
}
