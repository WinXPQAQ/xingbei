import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, Timing } from '../../src/engine.js';
import { DEFAULT_HERO_IDS, WAVE_TWO_HERO_IDS, WAVE_THREE_HERO_IDS, HERO_DEFINITIONS } from '../../src/hero.js';
import { actionCandidates } from '../candidates.mjs';
import { driveGame } from '../driver.mjs';
import { teacherIndex } from '../teacher.mjs';
import { encodeEntities } from './observation.mjs';
import { heroFields } from './hero-state.mjs';
const rosters = [DEFAULT_HERO_IDS, WAVE_TWO_HERO_IDS, WAVE_THREE_HERO_IDS];

test('entity boundary hides opponent hands/deck/logs at every seat; contracts cover registered heroes', async () => {
  assert.deepEqual(Object.keys(heroFields).sort(), Object.keys(HERO_DEFINITIONS).sort());
  for (const heroIds of rosters) for (let playerId = 0; playerId < 6; playerId++) {
    const game = new Game({ seed: 211102001, heroIds }).setup();
    game.current = playerId; await game.beginTurn(playerId);
    const hiddenDiscard = game.player((playerId + 1) % 6).hand[0];
    game.moveCard(hiddenDiscard.id, { zone: 'discard' }, { animate: false, visibility: 'hidden' });
    const request = { type: 'action' };
    const encode = () => JSON.stringify(encodeEntities({ game, playerId, request, candidates: actionCandidates(game, playerId) }));
    const before = encode();
    const history = structuredClone(game.publicHistory);
    for (const p of game.players.filter(p => p.id !== playerId)) for (const card of [...p.hand]) {
      const next = game.deck[0];
      game.moveCard(card.id, { zone: 'deck' }, { animate: false });
      game.moveCard(next.id, { zone: 'hand', playerId: p.id }, { animate: false });
    }
    const replacement = game.deck[0];
    game.moveCard(hiddenDiscard.id, { zone: 'deck' }, { animate: false });
    game.moveCard(replacement.id, { zone: 'discard' }, { animate: false, visibility: 'hidden' });
    Object.assign(game.publicHistory, history); game.deck.reverse();
    request.hidden = game.deck; game.log.push('PRIVATE_SENTINEL');
    assert.equal(encode(), before);
    game.player(playerId).hero.state.undeclared = 1;
    assert.throws(encode, /Undeclared hero state/);
  }
});

test('three rosters complete through entity interface with one reference per card', async () => {
  for (const heroIds of rosters) {
    const result = await driveGame({ seed: 211102001, heroIds }, input => {
      const encoded = encodeEntities(input);
      assert.equal(encoded.candidates.length, input.candidates.length);
      for (const token of [...encoded.entities, ...encoded.candidates])
        for (const refs of Object.values(token.refs)) for (const index of refs)
          assert.ok(Number.isInteger(index) && index >= 0 && index < encoded.entities.length);
      return teacherIndex(input, 'v1.8.0-preview.1');
    });
    assert.ok(result.terminated);
  }
});


test('nested trigger context reaches decisions and is restored after cancellation', () => {
  const game = new Game({ seed: 211102002 }).setup();
  const hero = game.player(0).hero;
  hero.skills = [];
  hero.addSkills({ id: 'outerProbe', ...hero.onOwnTurn([Timing.TURN_END]),
    *resolve() {
      yield* game.trigger(Timing.ACTION_PHASE_END, { playerId: 0, targetId: 2, amount: 4 });
      yield* game.offerSkill(0, 'outerProbe', 'probe');
    } }, { id: 'innerProbe', ...hero.onOwnTurn([Timing.ACTION_PHASE_END]),
    *resolve() { yield* game.offerSkill(0, 'innerProbe', 'probe'); } });
  const iterator = game.trigger(Timing.TURN_END, { playerId: 0, targetId: 1, amount: 2 });
  let step = iterator.next();
  while (step.value?.type !== 'skillChoice') step = iterator.next();
  const encode = () => encodeEntities({ game, playerId: 0, request: step.value, candidates: [true, false] });
  let observation = encode();
  assert.equal(observation.entities[observation.question].numbers.amount, 4);
  assert.deepEqual(observation.entities[observation.question].refs.target, [2]);
  const before = JSON.stringify(observation);
  game.activeTrigger.context.hiddenCards = game.deck;
  assert.equal(JSON.stringify(encode()), before);
  step = iterator.next(false);
  while (step.value?.type !== 'skillChoice') step = iterator.next();
  observation = encode();
  assert.equal(observation.entities[observation.question].numbers.amount, 2);
  assert.deepEqual(observation.entities[observation.question].refs.target, [1]);
  iterator.return();
  assert.equal(game.activeTrigger, undefined);
});
