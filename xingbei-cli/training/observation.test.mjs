import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Game } from '../src/engine.js';
import { actionCandidates } from './candidates.mjs';
import { encodeDecision } from './observation.mjs';
import { driveGame } from './driver.mjs';

test('all six seats ignore hidden faces, deck order, logs and injected request fields', async () => {
  for (let playerId = 0; playerId < 6; playerId++) {
    const game = new Game({ seed: 210000031 }).setup();
    game.current = playerId;
    await game.beginTurn(playerId);
    const request = { type: 'action' };
    const encode = () => encodeDecision({ game, playerId, request, candidates: actionCandidates(game, playerId) });
    const before = encode();
    const history = { ...game.publicHistory, actions: [...game.publicHistory.actions], events: [...game.publicHistory.events] };
    for (const player of game.players.filter(player => player.id !== playerId)) {
      for (const card of [...player.hand]) {
        const replacement = game.deck[0];
        game.moveCard(card.id, { zone: 'deck' }, { animate: false });
        game.moveCard(replacement.id, { zone: 'hand', playerId: player.id }, { animate: false });
      }
    }
    // A counterfactual hidden state with identical public evidence.
    Object.assign(game.publicHistory, history);
    game.deck.reverse();
    game.log.push('PRIVATE_SENTINEL');
    request.hidden = game.deck;
    request.title = 'PRIVATE_SENTINEL';
    assert.deepEqual(encode(), before);
    assert.ok(!JSON.stringify(before).includes('PRIVATE_SENTINEL'));
    for (const card of game.cards.values()) assert.ok(!JSON.stringify(before).includes(`"${card.id}"`));
    before.players[0].energy.gem = 100;
    assert.notEqual(game.player(playerId).energy.gem, 100);
    game.assertCardLocations();
  }
});

test('encoder handles natural six-hero decision paths', async () => {
  let state = 3;
  for (let i = 0; i < 24; i++) {
    const result = await driveGame({ seed: 210000000 + i }, input => {
      const output = encodeDecision(input);
      assert.equal(output.candidates.length, input.candidates.length);
      assert.ok(output.players.slice(1).every(player => player.hand === null));
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return Math.floor(state / 2 ** 32 * input.candidates.length);
    });
    assert.equal(result.terminated, true);
  }
});

test('persistent worker accepts two games and rejects stale selection IDs', { timeout: 30000 }, async () => {
  const worker = spawn(process.execPath, [new URL('./worker.mjs', import.meta.url).pathname], { stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: worker.stdout })[Symbol.asyncIterator]();
  let stderr = '';
  worker.stderr.on('data', text => { stderr += text; });
  const send = value => worker.stdin.write(JSON.stringify(value) + '\n');
  const read = async () => {
    const line = await lines.next();
    assert.equal(line.done, false, stderr);
    return JSON.parse(line.value);
  };
  try {
    for (let i = 0; i < 2; i++) {
      send({ type: 'start', config: { seed: 210000081 + i } });
      while (true) {
        const message = await read();
        assert.notEqual(message.type, 'error', message.error);
        if (message.type === 'result') { assert.equal(message.result.terminated, true); break; }
        assert.equal(message.type, 'decision');
        send({ type: 'select', id: message.id, index: 0 });
      }
    }
    send({ type: 'select', id: -1, index: 0 });
    assert.match((await read()).error, /Stale/);
  } finally { worker.kill(); }
});
