import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, Timing } from '../../src/engine.js';
import { DEFAULT_HERO_IDS, WAVE_TWO_HERO_IDS, WAVE_THREE_HERO_IDS, HERO_DEFINITIONS } from '../../src/hero.js';
import { actionCandidates } from '../candidates.mjs';
import { driveGame } from '../driver.mjs';
import { teacherIndex } from '../teacher.mjs';
import { encodeEntities } from './observation.mjs';
import { roster } from './rosters.mjs';
import { heroFields } from './hero-state.mjs';
const rosters = [DEFAULT_HERO_IDS, WAVE_TWO_HERO_IDS, WAVE_THREE_HERO_IDS];

test('entity boundary hides opponent hands/deck/logs at every seat; contracts cover registered heroes', async () => {
  assert.deepEqual(Object.keys(heroFields).sort(), Object.keys(HERO_DEFINITIONS).sort());
  for (const heroIds of Array.from({length:12}, (_,i)=>roster(i))) for (let playerId = 0; playerId < 6; playerId++) {
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

test('training enumerates both target orders and uses relative per-seat skill markers', async () => {
  const game = new Game({ seed: 211102003 }).setup();
  game.current = 4; await game.beginTurn(4);
  game.turn.state.usedSkills['doubleEcho:5'] = true;
  const spec = { targets: [1, 2], targetCount: 2, cardCount: 0 };
  game.legalSkillActions = () => [{ skillId: 'orderedProbe', spec }];
  game.skillActionSpec = () => spec;
  const candidates = actionCandidates(game, 4);
  assert.deepEqual(candidates.filter(c => c.skillId === 'orderedProbe').map(c => c.targetIds), [[1, 2], [2, 1]]);
  const o = encodeEntities({ game, playerId: 4, request: { type: 'action' }, candidates });
  assert.ok(o.entities.find(t => t.kind === 'turn').categorical.usedSkills.includes('doubleEcho:1'));
  assert.deepEqual(o.candidates.filter(c => c.categorical.skill === 'orderedProbe').map(c => c.refs.targets), [[3, 4], [4, 3]]);
});

test('conditional action selection preserves every command and teacher path without mutation', async () => {
  const { selectEntityDecision } = await import('./decisions.mjs');
  const candidates = Array.from({ length: 144 }, (_, i) => ({ type: 'skill', skillId: `skill${i % 2}`,
    cardIds: [Math.floor(i / 2) % 6], targetIds: [Math.floor(i / 12) % 6], stones: { gem: Math.floor(i / 72) } }));
  const input = { request: { type: 'action' }, candidates };
  const original = JSON.stringify(input);
  for (let teacher = 0; teacher < candidates.length; teacher++) {
    const steps = [];
    const selected = await selectEntityDecision(input, (step, answer) => {
      steps.push(step.request.stage);
      assert.ok(answer >= 0 && answer < step.candidates.length);
      return answer;
    }, { teacher });
    assert.equal(selected, teacher);
    assert.deepEqual(steps, ['action', 'cards', 'targets', 'completion']);
  }
  assert.equal(JSON.stringify(input), original);
  let calls = 0;
  assert.equal(await selectEntityDecision({ ...input, request: { type: 'response' } }, step => {
    calls++; assert.equal(step.candidates, candidates); return 7;
  }), 7);
  assert.equal(calls, 1);
  await assert.rejects(selectEntityDecision(input, () => -1), /Invalid subdecision/);
});

test('activation reservations tolerate moved hidden cards without exposing their faces', async () => {
  const game = new Game({ seed: 211103001 }).setup();
  await game.beginTurn(0);
  const card = game.player(0).hand[0];
  game.turn.state.reservedCardIds = [card.id];
  game.moveCard(card.id, { zone: 'discard' }, { animate: false, visibility: 'hidden' });
  const input = { game, playerId: 0, request: { type: 'action' }, candidates: [{ type: 'pass' }] };
  const before = encodeEntities(input);
  assert.deepEqual(before.entities.find(t => t.kind === 'reservation').refs.cards, []);
  game.turn.state.reservedCardIds = [];
  assert.deepEqual(encodeEntities(input), before);
  input.candidates = [{ type: 'skill', skillId: 'probe', cardIds: [card.id] }];
  assert.throws(() => encodeEntities(input), /non-visible card/);
});
