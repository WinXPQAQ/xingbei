import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { resolveDecision } from './decision-runner.mjs';
import { boundaryState, digest, phaseClass } from './entity/replay.mjs';
import { Game } from '../src/engine.js';
import { resolveAsync } from '../src/resolution/decisions.js';
import { decisionPlayer } from './candidates.mjs';

// Trusted simulator-side callback. Raw game/request never crosses into the
// learner: a separate encoder must construct its detached observation.
export async function driveGame({ seed, heroIds, start = 0, turnLimit = 500, decisionLimit = 10000, profile = false, replay = null, capture = false, revision = null, decisionMode = 'flat', ruleVariant = process.env.XINGBEI_TRAINING_RULE_VARIANT ?? 'standard' }, select, onBoundary = null) {
  if (replay && (replay.config.ruleVariant ?? 'standard') !== ruleVariant) throw new Error('Replay rule variant mismatch');
  const diagnosticDirectory = process.env.XINGBEI_DIAGNOSTIC_DIR ?? path.join(homedir(), '.local/share/xingbei-ml/rule-failures');
  const started = performance.now();
  const timings = { candidatesMs: 0, decisionWaitMs: 0, invariantsMs: 0 };
  const timed = (key, fn) => {
    if (!profile) return fn();
    const start = performance.now();
    try { return fn(); } finally { timings[key] += performance.now() - start; }
  };
  const game = new Game({ seed, ruleVariant, ...(heroIds ? { heroIds } : {}) }).setup();
  game.current = start;
  game.automaticDecision = request => { throw new Error(`Forbidden automatic fallback: ${request.type}`); };
  let decisions = 0, turns = 0, maxCandidates = 0;
  let engineRequests = 0, replayedEngineRequests = 0;
  const kinds = {};
  const diagnosticChoices = [];
  const choices = [], boundaries = [];
  let restored = !replay, pendingDecision = null;
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
    } else index = await select({ game, playerId, request, candidates, ...extra });
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
    return resolveDecision(game, playerId, request, input => {
      const { request: current, candidates, ...extra } = input;
      return pick(playerId, current, candidates, extra);
    }, {
      hierarchical: decisionMode === 'hierarchical-v1',
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
        if (action.type === 'pass') game.skipExtraActions(id);
        else if (action.type === 'activate') await game.activateAsync(id, { ...options, intent:action.intent });
        else {
          try { await game.executeAction(id, action, options); }
          catch (error) { if (!error.actionInvalidated) throw error; }
        }
        timed('invariantsMs', () => game.assertCardLocations());
        if (!game.winner && game.players.some(player => player.pendingOverflow)) throw new Error('Unresolved overflow after action');
      }
      await game.endTurnWithDecisions(options);
      timed('invariantsMs', () => game.assertCardLocations());
      boundary();
    }
    if (!restored) throw new Error('Replay boundary was not reached');
    if (!game.winner) reason = 'turnLimit';
  } catch (error) {
    if (error !== limit) {
      fs.mkdirSync(diagnosticDirectory, { recursive: true });
      fs.writeFileSync(`${diagnosticDirectory}/failure-${seed}-${process.pid}-${Date.now()}.json`, JSON.stringify({ seed, start, turns, decisions, error: error.stack, current: game.current, turn: game.turn.state, teams: game.teams, players: game.players.map(p => ({ id:p.id,name:p.name,team:p.team,hero:p.hero.id,state:p.hero.state,handLimit:p.handLimit,hand:p.hand,covered:p.covered,statuses:p.statuses,healing:p.healing,energy:p.energy })), config, pendingDecision, replayPrefix:choices, reproduction:"node training/reproduce.mjs FAILURE.json", choices:diagnosticChoices, deck:game.deck.map(c => c.id), discard:game.discard.map(c => c.id), cards:[...game.cards.values()], log:game.log, publicHistory:game.publicHistory }, null, 2));
      throw error;
    }
    reason = 'decisionLimit';
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
  return { seed, start, heroIds, revision, ruleVariant, inabilityForfeits, ...(capture ? {boundaries}:{}), replayedDecisions:replay?.choices.length ?? 0,
    engineRequests, replayedEngineRequests, turns, replayedTurns: replay?.turns ?? 0, decisions, maxCandidates, kinds,
    ...(profile ? { profile: { ...timings, elapsedMs: performance.now()-started } } : {}), winner: game.winner, terminated: !!game.winner, truncated: !game.winner, truncationReason: reason,
    publicBehavior, heroBehavior,
    rewards: game.winner ? Object.fromEntries(game.players.map(player => [player.id, player.team === game.winner ? 1 : -1])) : null };
}
