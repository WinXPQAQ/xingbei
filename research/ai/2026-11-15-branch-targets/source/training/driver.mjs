import { PublicHandMemory } from './public-hand-memory.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { resolveDecision } from './decision-runner.mjs';
import { boundaryState, digest, phaseClass } from './entity/replay.mjs';
import { Game } from '../src/engine.js';
import { resolveAsync } from '../src/resolution/decisions.js';
import { decisionPlayer } from './candidates.mjs';
import { classOf, CARD_CLASSES } from './entity/belief.mjs';
import { restoreSnapshot } from './entity/snapshot.mjs';

function lcg(seed) {
  let state = seed >>> 0;
  const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  random.clone = () => lcg(state);
  return random;
}

function shuffleSample(cards, random) {
  cards.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

// Preserve known membership, without preserving hidden hand or deck ordering.
// Optional weights come from a belief model that sees only the searcher's
// observation: weights[playerId][class], a multiplicative correction to the
// remaining pool. Unknown hand slots are filled card by card with probability
// proportional to remaining[class] * weight[class]; all-ones weights equal the
// uniform deal, and without weights every arrangement is equally likely.
export function resampleHidden(game, seat, seed, weights = null) {
  const random = lcg((seed * 2654435761 + 12345) >>> 0);
  const deckKnown = game.deck.filter(c => c.publicIdentity);
  const pool = game.deck.filter(c => !c.publicIdentity);
  const hands = [];
  for (const player of game.players) {
    if (player.id === seat) continue;
    const known = [];
    for (const card of player.hand) {
      if (card.publicIdentity || game.publicHandMemory?.knows(player.id, card)) known.push(card);
      else pool.push(card);
    }
    hands.push({ player, known, missing: player.hand.length - known.length });
  }
  shuffleSample(pool, random);
  if (weights) {
    const order = shuffleSample([...hands], random);
    const classes = pool.map(classOf);
    const remaining = new Array(CARD_CLASSES.length).fill(0);
    for (const c of classes) remaining[c]++;
    const used = new Array(pool.length).fill(false);
    for (const { player, known, missing } of order) {
      const w = weights[player.id];
      if (!w || w.length !== CARD_CLASSES.length) throw new Error('Belief weights missing for a player');
      const drawn = [];
      for (let slot = 0; slot < missing; slot++) {
        let total = 0;
        for (let c = 0; c < remaining.length; c++) if (remaining[c]) total += remaining[c] * Math.max(w[c], 1e-6);
        let pick = random() * total, chosen = -1;
        for (let c = 0; c < remaining.length && chosen < 0; c++) {
          if (!remaining[c]) continue;
          pick -= remaining[c] * Math.max(w[c], 1e-6);
          if (pick <= 0) chosen = c;
        }
        if (chosen < 0) chosen = remaining.findLastIndex(n => n > 0);
        const index = classes.findIndex((c, i) => c === chosen && !used[i]);
        used[index] = true; remaining[chosen]--;
        drawn.push(pool[index]);
      }
      const cards = shuffleSample(known.concat(drawn), random);
      player.hand.splice(0, player.hand.length, ...cards);
      for (const card of cards) card.setLocation({ zone: 'hand', playerId: player.id });
    }
    const deck = shuffleSample(deckKnown.concat(pool.filter((_, i) => !used[i])), random);
    game.deck.splice(0, game.deck.length, ...deck);
    for (const card of deck) card.setLocation({ zone: 'deck' });
    game.random = lcg(Math.floor(random() * 2 ** 32));
    game.assertCardLocations();
    return;
  }
  let offset = 0;
  for (const { player, known, missing } of hands) {
    const cards = shuffleSample(known.concat(pool.slice(offset, offset + missing)), random);
    offset += missing;
    player.hand.splice(0, player.hand.length, ...cards);
    for (const card of cards) card.setLocation({ zone: 'hand', playerId: player.id });
  }
  const deck = shuffleSample(deckKnown.concat(pool.slice(offset)), random);
  game.deck.splice(0, game.deck.length, ...deck);
  for (const card of deck) card.setLocation({ zone: 'deck' });
  game.random = lcg(Math.floor(random() * 2 ** 32));
  game.assertCardLocations();
}

// Trusted simulator-side callback. Raw game/request never crosses into the
// learner: a separate encoder must construct its detached observation.
export async function driveGame({ seed, heroIds, start = 0, turnLimit = 500, decisionLimit = 10000, profile = false, replay = null, capture = false, captureSeat = null, returnChoices = false, trackPublicHands = false, forced = null, focalTurn = null, continuationSeed = null, resample = null, startState = null, startConfig = null, revision = null, decisionMode = 'flat', ruleVariant = process.env.XINGBEI_TRAINING_RULE_VARIANT ?? 'standard' }, select, onBoundary = null) {
  if (replay && (replay.config.ruleVariant ?? 'standard') !== ruleVariant) throw new Error('Replay rule variant mismatch');
  const diagnosticDirectory = process.env.XINGBEI_DIAGNOSTIC_DIR ?? path.join(homedir(), '.local/share/xingbei-ml/rule-failures');
  const started = performance.now();
  const timings = { candidatesMs: 0, decisionWaitMs: 0, invariantsMs: 0 };
  const timed = (key, fn) => {
    if (!profile) return fn();
    const start = performance.now();
    try { return fn(); } finally { timings[key] += performance.now() - start; }
  };
  // startState: continue a recorded game (e.g. a human game snapshot taken just
  // before a turn) instead of dealing a new one. Public hand memory then starts
  // empty: cards revealed before the snapshot are treated as unknown.
  const game = startState ? restoreSnapshot(startConfig, startState)
    : new Game({ seed, ruleVariant, ...(heroIds ? { heroIds } : {}) });
  if (trackPublicHands || resample) game.publicHandMemory = new PublicHandMemory();
  if (!startState) { game.setup(); game.current = start; }
  game.automaticDecision = request => { throw new Error(`Forbidden automatic fallback: ${request.type}`); };
  let decisions = 0, turns = 0, maxCandidates = 0;
  let engineRequests = 0, replayedEngineRequests = 0;
  const kinds = {};
  const diagnosticChoices = [];
  const choices = [], boundaries = [], focalBoundaries = [];
  let restored = !replay, pendingDecision = null, forcedUsed = 0, reshuffled = false, resampled = false;
  const publicTeamState = team => ({
    morale: game.teams[team].morale,
    cups: game.teams[team].cups,
    healing: game.players.filter(player => player.team === team).reduce((total, player) => total + player.healing, 0),
  });
  const publicBehavior = { schema: 'team-behavior-v1', seats: Object.fromEntries(game.players.map(player => [player.id, player.team])), teams: {} };
  // Diagnostics only: never consumed by the policy or by the reward function.
  const heroBehavior = Object.fromEntries(game.players.map(p => [p.id, {hero:p.hero.id,turns:0,rootActions:{},skillNotes:{},coveredAdded:0,enemyAttackDamage:0,enemySpellDamage:0,refineGem:0,refineCrystal:0}]));
  function resetPublicBehavior() {
    for (const team of Object.keys(game.teams)) publicBehavior.teams[team] = {
      start: publicTeamState(team), turns: 0, attackAttempts: 0, attackHits: 0,
      attackDamage: 0, spellDamage: 0, healingSpent: 0, holyLightBlocks: 0,
    };
  }
  resetPublicBehavior();
  const recordPublicAction = game.recordPublicAction;
  game.recordPublicAction = function (event) {
    recordPublicAction.call(this, event);
    if (!restored) return;
    const actorId = event.actorId ?? event.sourceId ?? event.playerId;
    const actor = heroBehavior[actorId];
    if (actor) {
      if (event.type === 'turn') actor.turns++;
      if (event.type === 'skillNote') actor.skillNotes[event.skillId] = (actor.skillNotes[event.skillId] ?? 0) + 1;
      if (event.type === 'cover') actor.coveredAdded += event.count ?? 0;
      if (event.type === 'refine') { actor.refineGem += event.gem ?? 0; actor.refineCrystal += event.crystal ?? 0; }
      if (event.type === 'damage' && event.targetId != null && game.player(event.targetId).team !== game.player(actorId).team)
        actor[event.result === 'attack' ? 'enemyAttackDamage' : 'enemySpellDamage'] += Math.max(0, event.amount ?? 0);
    }
    const team = actorId == null ? null : publicBehavior.seats[actorId];
    const own = publicBehavior.teams[team];
    if (!own) return;
    const opponentTarget = event.targetId != null && publicBehavior.seats[event.targetId] !== team;
    if (event.type === 'turn') own.turns++;
    if (event.type === 'attack' && opponentTarget) own.attackAttempts++;
    if (event.type === 'attackResult' && opponentTarget && event.result === 'hit') own.attackHits++;
    if (event.type === 'damage' && opponentTarget) {
      const key = event.result === 'attack' ? 'attackDamage' : 'spellDamage';
      own[key] += Math.max(0, event.amount ?? 0);
    }
    // These are actual public payments/responses, with no counterfactual claim
    // about how much morale would have been lost without them.
    if (event.type === 'healing' && event.result === 'prevent') own.healingSpent += Math.max(0, event.amount ?? 0);
    if (event.type === 'response' && event.card === 'holyLight' && event.result === 'cancel') own.holyLightBlocks++;
  };
  const limit = Symbol('decisionLimit');
  async function pick(playerId, request, candidates, extra = {}) {
    pendingDecision = {playerId, type:request.type, skillId:request.skillId, purpose:request.purpose, count:request.count, stage:request.stage, prefix:request.prefix, selectedIndices:request.selectedIndices, candidates};
    if (decisions >= decisionLimit) throw limit;
    if (!candidates.length) throw new Error(`Empty candidates: ${request.type}`);
    decisions++;
    kinds[request.type] = (kinds[request.type] ?? 0) + 1;
    maxCandidates = Math.max(maxCandidates, candidates.length);
    const start = profile ? performance.now() : 0;
    let index;
    if (!restored) {
      const entry = replay.choices[choices.length];
      if (!entry || entry.playerId !== playerId || entry.type !== request.type || (entry.stage ?? null) !== (request.stage ?? null) || entry.candidatesHash !== digest(candidates)) throw new Error('Replay decision diverged');
      index = entry.index;
    } else if (forced && forcedUsed < forced.length) {
      // Exact within-turn prefix of a branch: removes batch-dependent drift.
      // Resample just before the searched seat's own final forced choice: its
      // candidates depend only on its own state, and every later request
      // (including immediate responses) is built from the resampled state.
      if (resample && !resampled && forcedUsed === forced.length - 1 && playerId === resample.seat) {
        resampled = true; resampleHidden(game, resample.seat, resample.seed, resample.weights ?? null);
      }
      const entry = forced[forcedUsed++];
      if (entry.playerId !== playerId || entry.type !== request.type || (entry.stage ?? null) !== (request.stage ?? null) ||
          (entry.candidatesHash && entry.candidatesHash !== digest(candidates))) {
        const error = new Error('Forced branch prefix diverged'); error.branchStop = 'forcedDiverged'; throw error;
      }
      index = entry.index;
    } else {
      if (resample && !resampled && playerId === resample.seat && request.type === 'action') {
        resampled = true; resampleHidden(game, resample.seat, resample.seed, resample.weights ?? null);
      }
      index = await select({ game, playerId, request, candidates, turn: turns, ...extra });
    }
    if (profile) timings.decisionWaitMs += performance.now() - start;
    if (!Number.isInteger(index) || index < 0 || index >= candidates.length) throw new Error(`Invalid candidate index ${index}`);
    diagnosticChoices.push({ playerId, requestType: request.type, skillId: request.skillId, stage:request.stage, prefix:request.prefix, selectedIndices:request.selectedIndices, candidates, index });
    choices.push({ playerId, type:request.type, ...(request.stage ? {stage:request.stage} : {}), candidatesHash:digest(candidates), index });
    return index;
  }
  async function chooseDecision(playerId, request) {
    engineRequests++;
    if (!restored) replayedEngineRequests++;
    pendingDecision = { playerId, type: request.type, skillId: request.skillId, purpose: request.purpose, count: request.count };
    if (request.type === 'action') {
      // No selectable action at all: the seat cannot act. Forfeit and archive
      // instead of stopping training; coverage gaps are fixed from archives.
      try { return await resolveAction(playerId, request); }
      catch (error) {
        if (!/^Empty (conditional decision|candidates)/.test(error?.message ?? '')) throw error;
        game.winner = game.player(playerId).team === 'red' ? 'blue' : 'red';
        game.inabilityArchives.push(JSON.parse(JSON.stringify({ version: 1, initialConfig: game.initialConfig,
          reason: 'noSelectableAction', responsiblePlayerId: playerId, targetId: playerId, skillId: 'noSelectableAction',
          evidence: { error: error.message, decisionMode }, winner: game.winner, turn: game.turn.state, current: game.current,
          teams: game.teams, players: game.players.map(p => p.toJSON()), cards: [...game.cards.values()],
          deck: game.deck.map(c => c.id), discard: game.discard.map(c => c.id), log: game.log.slice(-60) })));
        return { type: 'forfeit' };
      }
    }
    return resolveAction(playerId, request);
  }
  function resolveAction(playerId, request) {
    return resolveDecision(game, playerId, request, input => {
      const { request: current, candidates, ...extra } = input;
      return pick(playerId, current, candidates, extra);
    }, {
      hierarchical: decisionMode === 'hierarchical-v1' || decisionMode === 'hierarchical-v2',
      mode: decisionMode,
      measureCandidates: operation => timed('candidatesMs', operation),
    });
  }
  async function decide(request) {
    const playerId = decisionPlayer(request);
    const value = await chooseDecision(playerId, request);
    if (request.type === 'overflow' && !request.resolveInternally) return game.resolveOverflowWithDecisions(playerId, value, options);
    return value;
  }
  const options = { overflow: 'defer', choose: decide, chooseResponse: decide, chooseTarget: decide, resolveOverflow: decide };
  let reason = null;
  const config = {seed,heroIds,start,turnLimit,decisionLimit,revision,decisionMode,ruleVariant};
  function boundary() {
    if (game.winner || game.players.some(p=>p.pendingOverflow) || game.processingRuleEvents || game.pendingRuleEvents.length) return;
    if (!restored && turns === replay.turns) {
      if (choices.length !== replay.choices.length || digest(boundaryState(game)) !== replay.hash || revision !== replay.revision) throw new Error('Replay boundary mismatch');
      restored = true;
      resetPublicBehavior();
      onBoundary?.(game);
    }
    // Branch-target experiments: positions immediately before the focal seat's
    // turn. Only counts are kept; the caller slices this game's choice list.
    if (restored && captureSeat != null && game.current === captureSeat)
      focalBoundaries.push({ turns, choiceCount: choices.length, hash: digest(boundaryState(game)),
        energy: { ...game.player(captureSeat).energy }, phase: phaseClass(game) ?? 'early' });
    if (restored && capture) {
      const category = phaseClass(game);
      if (category && !boundaries.some(b=>b.category===category)) boundaries.push({category, turns, hash:digest(boundaryState(game)), choices:[...choices], revision, config});
    }
  }
  try {
    boundary();
    while (!game.winner && turns < turnLimit) {
      turns++;
      const id = game.current;
      await game.beginTurn(id, { ...options, chooseWeakness: decide }, options);
      while (game.turn.needsAction()) {
        // Adjudicate genuine post-activation inability before asking a policy
        // for candidates. Malformed candidates in an actionable state still fail.
        await resolveAsync(game.restoreRandomInability(id, options), decide);
        if (game.winner) break;
        const action = await chooseDecision(id, { type: 'action' });
        if (restored) {
          const key = action.type === 'skill' ? action.skillId : action.type;
          heroBehavior[id].rootActions[key] = (heroBehavior[id].rootActions[key] ?? 0) + 1;
        }
        if (action.type === 'forfeit') break;
        if (action.type === 'pass') game.skipExtraActions(id);
        else if (action.type === 'activate') await game.activateAsync(id, { ...options, intent:action.intent });
        else {
          // v2 direct ordinary action: run the (effect-free for this hero) activation first.
          const ordinary = action.type === 'play' || (action.type === 'skill' && game.skillActionSpec(id, action)?.type !== 'special');
          if (decisionMode === 'hierarchical-v2' && ordinary && game.turn.state && !game.turn.state.activationDone)
            await game.activateAsync(id, { ...options, intent: action });
          try { await game.executeAction(id, action, options); }
          catch (error) { if (!error.actionInvalidated) throw error; }
        }
        timed('invariantsMs', () => game.assertCardLocations());
        if (!game.winner && game.players.some(player => player.pendingOverflow)) throw new Error('Unresolved overflow after action');
      }
      await game.endTurnWithDecisions(options);
      timed('invariantsMs', () => game.assertCardLocations());
      if (restored && continuationSeed != null && !reshuffled && focalTurn != null && turns >= focalTurn) {
        // Continuation sample k: the focal player cannot know the deck order,
        // so the remaining deck and later randomness are redrawn after the turn.
        reshuffled = true;
        let state = (continuationSeed * 2654435761 + 97) >>> 0;
        const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
        for (let i = game.deck.length - 1; i > 0; i--) {
          const j = Math.floor(random() * (i + 1));
          [game.deck[i], game.deck[j]] = [game.deck[j], game.deck[i]];
        }
        const next = (seed => { let st = seed >>> 0; const r = () => ((st = (st * 1664525 + 1013904223) >>> 0) / 2 ** 32); r.clone = () => { const c = next(st); return c; }; return r; });
        game.random = next(Math.floor(random() * 2 ** 32));
      }
      boundary();
    }
    if (!restored) throw new Error('Replay boundary was not reached');
    if (!game.winner) reason = 'turnLimit';
  } catch (error) {
    if (error !== limit && !error?.branchStop) {
      fs.mkdirSync(diagnosticDirectory, { recursive: true });
      fs.writeFileSync(`${diagnosticDirectory}/failure-${seed}-${process.pid}-${Date.now()}.json`, JSON.stringify({ seed, start, turns, decisions, error: error.stack, current: game.current, turn: game.turn.state, teams: game.teams, players: game.players.map(p => ({ id:p.id,name:p.name,team:p.team,hero:p.hero.id,state:p.hero.state,handLimit:p.handLimit,hand:p.hand,covered:p.covered,statuses:p.statuses,healing:p.healing,energy:p.energy })), config, pendingDecision, replayPrefix:choices, reproduction:"node training/reproduce.mjs FAILURE.json", choices:diagnosticChoices, deck:game.deck.map(c => c.id), discard:game.discard.map(c => c.id), cards:[...game.cards.values()], log:game.log, publicHistory:game.publicHistory }, null, 2));
      throw error;
    }
    reason = error?.branchStop ? 'branchStop' : 'decisionLimit';
  } finally {
    game.recordPublicAction = recordPublicAction;
  }
  for (const team of Object.keys(game.teams)) publicBehavior.teams[team].end = publicTeamState(team);
  if (game.inabilityArchives.length) fs.mkdirSync(diagnosticDirectory, { recursive: true });
  const inabilityForfeits = game.inabilityArchives.map((archive,index) => {
    const file = `${diagnosticDirectory}/inability-forfeit-${seed}-${Date.now()}-${process.pid}-${index}.json`;
    fs.writeFileSync(file,JSON.stringify({...archive,config,revision,replayPrefix:choices,choices:diagnosticChoices,reproduction:'node training/reproduce.mjs ARCHIVE.json'},null,2),{flag:'wx'});
    return {file,skillId:archive.skillId,responsiblePlayerId:archive.responsiblePlayerId,targetId:archive.targetId};
  });
  // User ruling: inability forfeits are terminal losses, archived without
  // interrupting the training run. Other simulator errors still propagate.
  return { seed, start, heroIds, revision, ruleVariant, inabilityForfeits, ...(capture ? {boundaries}:{}), ...(captureSeat != null || returnChoices ? {focalBoundaries, choices} : {}), forcedUsed, replayedDecisions:replay?.choices.length ?? 0,
    engineRequests, replayedEngineRequests, turns, replayedTurns: replay?.turns ?? 0, decisions, maxCandidates, kinds,
    ...(profile ? { profile: { ...timings, elapsedMs: performance.now()-started } } : {}), winner: game.winner, terminated: !!game.winner, truncated: !game.winner, truncationReason: reason,
    ...(trackPublicHands ? {publicHandEvents: game.publicHandMemory.events} : {}),
    publicBehavior, heroBehavior,
    rewards: game.winner ? Object.fromEntries(game.players.map(player => [player.id, player.team === game.winner ? 1 : -1])) : null };
}
