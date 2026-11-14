import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, Timing } from '../../src/engine.js';
import { AI_POLICY_VERSION } from '../../src/ai.js';
import { DEFAULT_HERO_IDS, WAVE_TWO_HERO_IDS, WAVE_THREE_HERO_IDS, HERO_DEFINITIONS } from '../../src/hero.js';
import { actionCandidates } from '../candidates.mjs';
import { buildDecisionSpace } from '../decision-space.mjs';
import { resolveDecision } from '../decision-runner.mjs';
import { driveGame } from '../driver.mjs';
import { teacherIndex } from '../teacher.mjs';
import { createEntityEncoder, encodeEntities } from './observation.mjs';
import { createTeacherSampler } from './teacher-sampling.mjs';
import { HERO_IDS, roster } from './rosters.mjs';
import { heroFields } from './hero-state.mjs';
import { createWireEncoder } from './wire.mjs';
import { estimateActionCapabilities, ACTION_CAPABILITY_SYMBOLS } from '../../src/ai/action-capability.js';
const rosters = [DEFAULT_HERO_IDS, WAVE_TWO_HERO_IDS, WAVE_THREE_HERO_IDS];

test('typed binary writer preserves exact frame bytes for both index widths',async()=>{
  const saved=process.env.XINGBEI_WIRE_MODE;
  try{
    process.env.XINGBEI_WIRE_MODE='legacy';
    const legacy=await import('./binary-wire.mjs?pipeline-legacy');
    process.env.XINGBEI_WIRE_MODE='typed';
    const typed=await import('./binary-wire.mjs?pipeline-typed');
    for(const feature of [3,70000]){
      const observation={schema:'entities-v7',question:0,vocabulary:'test',
        entities:[[[1,2],[1,Math.log1p(2)],[1],[0]]],
        candidates:[[[feature,1],[-0,-1.5],[],[]]]};
      const a=legacy.encodeTensorWire(observation),b=typed.encodeTensorWire(observation);
      assert.deepEqual(b,a);
      assert.equal(b.observation.indexBytes,feature===3?2:4);
    }
  }finally{
    if(saved===undefined)delete process.env.XINGBEI_WIRE_MODE;else process.env.XINGBEI_WIRE_MODE=saved;
  }
});

test('request-scoped encoding preserves independent samples and bounded complete teacher chains', async () => {
  const game = new Game({ seed: 211109001, heroRules: false }).setup();
  const player = game.player(0);
  while (player.hand.length < 12) game.moveCard(game.deck[0].id, { zone: 'hand', playerId: 0 });
  player.handLimit = 6;
  const encode = createEntityEncoder(), roots = [], scopes = [], snapshots = [];
  const plainWire=createWireEncoder(['<pad>','<unknown>']);
  const cachedWire=createWireEncoder(['<pad>','<unknown>'],{cachePrefix:true});
  const choose = input => {
    roots.push(input.rootRequest);
    scopes.push(input.decisionScope);
    const observation = encode(input);
    assert.deepEqual(observation, encodeEntities(input));
    assert.deepEqual(cachedWire(observation),plainWire(observation));
    const wire=cachedWire(observation);
    wire.entities[0][0][0]=999;
    assert.deepEqual(cachedWire(encode(input)),plainWire(observation));
    snapshots.push(JSON.stringify(observation));
    observation.entities[0].numbers.probe = 999;
    const refs = observation.entities.find(token => Object.values(token.refs).some(values => values.length));
    Object.values(refs.refs).find(values => values.length).push(999);
    assert.deepEqual(encode(input), encodeEntities(input));
    return teacherIndex(input, AI_POLICY_VERSION);
  };
  const request = { type: 'overflow', playerId: 0 };
  const before = player.hand.map(card => card.id);
  const discarded = await resolveDecision(game, 0, request, choose);
  assert.equal(discarded.length, 6);
  assert.deepEqual(player.hand.map(card => card.id), before);
  assert.equal(new Set(scopes).size, 1);
  assert.ok(roots.every(root => root === request));
  assert.equal(new Set(snapshots).size, 6);
  const firstScope = scopes[0];
  game.moveCard(player.hand[0].id, { zone: 'discard' });
  await resolveDecision(game, 0, request, choose);
  assert.notEqual(scopes.at(-1), firstScope);

  const scope = {}, root = { type: 'skillChoice' };
  const input = { game, playerId: 0, rootRequest: root, decisionScope: scope,
    request: { type: 'skillChoice', playerId: 0 }, candidates: [true, false] };
  const initial = encode(input);
  input.request.revealedCards = [game.player(1).hand[0]];
  assert.notDeepEqual(encode(input), initial);
  assert.deepEqual(encode(input), encodeEntities(input));
  game.moveCard(game.deck[0].id, { zone: 'hand', playerId: 0 });
  input.rootRequest = { type: 'skillChoice' };
  assert.deepEqual(encode(input), encodeEntities(input));

  const config = { version: 'stratified-chains-v1', samplesPerSeat: 2, chainSteps: 3, bytesPerGame: 30000 };
  const sample = () => {
    const sampler = createTeacherSampler(211109001, config);
    for (let seat = 0; seat < 6; seat++) for (const steps of [3, 4, 1]) {
      const rootRequest = {};
      for (let step = 0; step < steps; step++) {
        const observation = { schema: 'entities-v7', question: 0,
          entities: [{ kind: 'question', categorical: { type: 'cardChoice', stage: String(step),
            payload: steps === 1 ? 'x'.repeat(config.bytesPerGame) : '' }, numbers: {}, refs: {} }],
          candidates: [{ kind: 'candidate', categorical: {}, numbers: {}, refs: {} }] };
        sampler.add({ playerId: seat, rootRequest }, 0, observation);
      }
    }
    return sampler.finish();
  };
  const retained = sample();
  assert.deepEqual(retained, sample());
  assert.ok(retained.sampling.retainedBytes <= config.bytesPerGame);
  for (const coverage of retained.sampling.coverage) {
    assert.equal(coverage.eligibleChains, 1);
    assert.equal(coverage.omittedChains, 2);
    assert.equal(coverage.oversizedSamples, 1);
    assert.equal(coverage.retainedChain.steps, 3);
    assert.deepEqual(retained.decisions.filter(row => row.sample.chain === coverage.retainedChain.id)
      .map(row => row.sample.step), [0, 1, 2]);
  }
});

test('entity boundary hides opponent hands/deck/logs at every seat; contracts cover registered heroes', async () => {
  assert.deepEqual(Object.keys(heroFields).sort(), Object.keys(HERO_DEFINITIONS).sort());
  const plain = { observer: 0, teams: { red: { morale: 10 }, blue: { morale: 10 } },
    players: DEFAULT_HERO_IDS.map((hero, id) => ({ id, hero, team: [0, 3, 4].includes(id) ? 'red' : 'blue',
      count: 1, limit: 6, energy: { gem: 0, crystal: 0 }, healing: 0,
      heroState: {}, skillIds: ['bloodBlade'],
      ...(id === 0 ? { hand: [{ name: 'fireStrike', type: 'attack', elements: ['fire'], uniqueSkills: ['bloodBlade'] }] } : {}),
    })) };
  for (const player of plain.players.slice(1)) for (const key of ['hand', 'known'])
    Object.defineProperty(player, key, { get() { throw new Error('Capability accessed another hand'); } });
  const knownAttack = estimateActionCapabilities(plain);
  assert.equal(knownAttack[0].numbers.abilityOwnUniqueAttacks, 1);
  assert.ok(knownAttack.every(entry => entry.numbers.abilityCountEstimate > 0));
  for (const entry of knownAttack) for (const [key, value] of Object.entries(entry.numbers)) {
    assert.ok(ACTION_CAPABILITY_SYMBOLS.includes(`number:${key}`));
    assert.ok(Number.isFinite(value));
  }
  plain.players[0].hand = [{ name: 'holyLight', type: 'spell', elements: ['light'], uniqueSkills: [] }];
  const knownLight = estimateActionCapabilities(plain);
  assert.equal(knownLight[0].numbers.abilityHolyLights, 1);
  assert.equal(knownLight[0].numbers.abilityAttackElements, 0);
  assert.equal(knownAttack[0].numbers.abilityCountEstimate, knownLight[0].numbers.abilityCountEstimate);
  assert.deepEqual(knownAttack.slice(1), knownLight.slice(1));
  const seats=new Map(HERO_IDS.map(id=>[id,Array(6).fill(0)]));
  for(let i=0;i<HERO_IDS.length;i++) {
    const ids=roster(i);
    assert.equal(new Set(ids).size,6);
    assert.ok(!ids.includes('magicArcherEX'));
    assert.ok(!ids.includes('lawgiver'));
    ids.forEach((id,seat)=>seats.get(id)[seat]++);
  }
  assert.ok([...seats.values()].every(counts=>counts.every(count=>count===1)));
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
  const game = new Game({ seed: 211105004, heroIds: ['magicSwordsman', 'butterflyDancer', ...DEFAULT_HERO_IDS.slice(2)] }).setup();
  await game.beginTurn(0);
  game.coverCards(1, game.player(1).hand.slice(0, 2), 'cocoon');
  const input = { game, playerId: 0, request: { type: 'action' }, candidates: [{ type: 'direction', direction: 'activate' }] };
  const before = encodeEntities(input), history = structuredClone(game.publicHistory);
  assert.ok(before.entities.some(t => t.kind === 'activationInteraction' && t.categorical.hiddenDependent));
  assert.equal(before.entities.find(t => t.kind === 'activationPreview').categorical.coverage, 'declared-effects-only');
  for (const card of [...game.player(1).covered]) {
    const replacement = game.deck[0];
    game.moveCard(card.id, { zone: 'deck' }, { animate: false });
    game.coverCards(1, [replacement], 'cocoon', { sources: ['deck'] });
  }
  Object.assign(game.publicHistory, history);
  assert.deepEqual(encodeEntities(input), before);
});

test('three rosters complete through entity interface with one reference per card', async () => {
  for (const heroIds of rosters) {
    const result = await driveGame({ seed: 211102001, heroIds, decisionMode: 'hierarchical-v1' }, input => {
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
  await game.activateAsync(4, {choose: request => request.defaultValue});
  game.turn.state.usedSkills['doubleEcho:5'] = true;
  const spec = { targets: [1, 2], targetCounts: [1, 2], cardCount: 0 };
  game.legalSkillActions = () => [{ skillId: 'orderedProbe', spec }];
  game.skillActionSpec = () => spec;
  const candidates = actionCandidates(game, 4);
  assert.deepEqual(candidates.filter(c => c.skillId === 'orderedProbe').map(c => c.targetIds), [[1], [2], [1, 2], [2, 1]]);
  for (const command of candidates.filter(c => c.skillId === 'orderedProbe')) {
    let branch = buildDecisionSpace(game, 4, {type:'action'});
    while (!branch.done) {
      if (branch.request.stage === 'targets') {
        assert.equal(branch.request.count, command.targetIds.length);
        assert.equal(branch.request.remainingCount, command.targetIds.length - branch.request.prefix.targetIds.length);
      }
      branch = branch.next(branch.candidates[branch.teacherIndex(command)]);
    }
    assert.deepEqual(branch.value, command);
  }
  const o = encodeEntities({ game, playerId: 4, request: { type: 'action' }, candidates });
  assert.ok(o.entities.find(t => t.kind === 'turn').categorical.usedSkills.includes('doubleEcho:1'));
  assert.deepEqual(o.candidates.filter(c => c.categorical.skill === 'orderedProbe').map(c => c.refs.targets), [[3], [4], [3, 4], [4, 3]]);
});

test('lazy choices preserve legal leaves and choose a large discard without combinations or mutation', async () => {
  const game = new Game({ seed: 211105001, heroRules: false }).setup();
  const player = game.player(0);
  while(player.hand.length < 12) game.moveCard(game.deck[0].id, {zone:'hand',playerId:0});
  player.handLimit = 6;
  const before = player.hand.map(card=>card.id);
  let node = buildDecisionSpace(game, 0, {type:'overflow',playerId:0});
  const wanted = [1,3,5,7,9,11], sizes = [];
  while(!node.done) {
    sizes.push(node.candidates.length);
    node = node.next(node.candidates[node.teacherIndex(wanted)]);
    assert.deepEqual(player.hand.map(card=>card.id), before);
  }
  assert.deepEqual(node.value, wanted);
  assert.deepEqual(sizes, [12,11,10,9,8,7]);
  const constrained = {type:'cardChoice',playerId:0,valid:[0,1,2,3],count:2,validSets:[[0,1],[2,3]],optional:true};
  node = buildDecisionSpace(game,0,constrained).next([2]);
  assert.deepEqual(node.candidates, [[3]]);
  assert.deepEqual(node.next([3]).value, [2,3]);
  assert.equal(buildDecisionSpace(game,0,constrained).next(null).value, null);
  node = buildDecisionSpace(game,0,{...constrained,valid:[0,2,1],validSets:[[0,2],[1,2]]}).next([2]);
  assert.deepEqual(node.next([1]).value, [1,2]);
  await game.beginTurn(0);
  await game.activateAsync(0);
  const tree = buildDecisionSpace(game,0,{type:'action'});
  for(const command of actionCandidates(game,0)) {
    let branch = tree;
    while(!branch.done) branch=branch.next(branch.candidates[branch.teacherIndex(command)]);
    assert.deepEqual(branch.value, command);
  }
});

test('decision prefixes and summaries reference visible entities; activation plans stay private', async () => {
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
  input.candidates = [{ type: 'direction', direction: 'attack' }];
  input.summaries = [{ cardIds: [game.player(0).hand[0].id], targetIds: [1] }];
  const direction = encodeEntities(input);
  assert.equal(direction.candidates[0].categorical.direction, 'attack');
  assert.equal(direction.candidates[0].refs.availablecards.length, 1);
  input.summaries[0].cardIds = [card.id];
  assert.throws(() => encodeEntities(input), /non-visible card/);
  delete input.summaries;
  input.request = { type: 'overflow', stage: 'selectCards', prefix: [0], remainingCount: 1 };
  input.candidates = [[1], []];
  const sequence = encodeEntities(input);
  assert.equal(sequence.entities[sequence.question].refs.selectedCards.length, 1);
  assert.equal(sequence.entities[sequence.question].numbers.remainingCount, 1);
  assert.deepEqual(sequence.candidates.map(t => t.categorical.finish), [false, true]);
  game.turn.state.activationIntent = { type: 'attack', cardIds: [card.id], targetIds: [1] };
  assert.deepEqual(encodeEntities(input).entities.find(t => t.kind === 'activationIntent').refs.cards, []);
  const opponent = { ...input, playerId: 1, request: { type: 'skillChoice' }, candidates: [true, false] };
  const privateBefore = encodeEntities(opponent);
  game.turn.state.activationIntent = { type: 'flexible' };
  assert.deepEqual(encodeEntities(opponent), privateBefore);
});

test('normal route is chosen before activation; cards are offered again after its draw', async () => {
  const game = new Game({ seed: 211104001, heroRules: false }).setup();
  const player = game.player(0);
  for (const card of [...player.hand]) game.moveCard(card.id, { zone: 'outside' });
  const fire = game.deck.find(c => c.type === 'attack' && c.element === 'fire');
  const water = game.deck.find(c => c.type === 'attack' && c.element === 'water');
  game.moveCard(fire.id, { zone: 'hand', playerId: 0 });
  game.moveCard(water.id, { zone: 'outside' });
  game.moveCard(water.id, { zone: 'deck' });
  let activations = 0;
  player.hero.addSkills({ id: 'activationDrawProbe', ...player.hero.onOwnTurn([Timing.ACTIVATION]),
    *resolve({ game, player, options }) {
      activations++;
      yield* game.drawSteps(player.id, 1, options);
    } });
  await game.beginTurn(0);
  const before = actionCandidates(game, 0);
  assert.ok(before.some(c => c.type === 'activate'));
  assert.ok(before.some(c => c.type === 'purchase'));
  assert.ok(!before.some(c => ['play', 'skill'].includes(c.type)));
  const encoded = encodeEntities({ game, playerId: 0, request: { type: 'action' }, candidates: before });
  assert.ok(encoded.candidates.some(c => c.categorical.type === 'activate'));
  assert.equal(encoded.entities.find(t => t.kind === 'turn').categorical.activationDone, false);
  await game.activateAsync(0);
  assert.equal(activations, 1);
  assert.equal(game.turn.state.completed, false);
  const after = actionCandidates(game, 0);
  assert.ok(after.some(c => c.type === 'play' && player.hand[c.index]?.id === water.id));
  assert.ok(!after.some(c => ['activate', 'purchase', 'synthesize', 'refine'].includes(c.type)));
  const selected = after.find(c => c.type === 'play' && player.hand[c.index]?.id === water.id);
  await game.executeAction(0, selected, {chooseResponse: () => null, choose: request => request.defaultValue});
  assert.equal(activations, 1);
  assert.ok(player.hand.some(c => c.id === fire.id));
});
