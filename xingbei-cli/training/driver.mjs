import fs from 'node:fs';
import { Game } from '../src/engine.js';
import { actionCandidates, decisionCandidates, decisionPlayer } from './candidates.mjs';

// Trusted simulator-side callback. Raw game/request never crosses into the
// learner: a separate encoder must construct its detached observation.
export async function driveGame({ seed, heroIds, start = 0, turnLimit = 500, decisionLimit = 10000, profile = false }, select) {
  const started = performance.now();
  const timings = { candidatesMs: 0, decisionWaitMs: 0, invariantsMs: 0 };
  const timed = (key, fn) => {
    if (!profile) return fn();
    const start = performance.now();
    try { return fn(); } finally { timings[key] += performance.now() - start; }
  };
  const game = new Game({ seed, ...(heroIds ? { heroIds } : {}) }).setup();
  game.current = start;
  game.automaticDecision = request => { throw new Error(`Forbidden automatic fallback: ${request.type}`); };
  let decisions = 0, turns = 0, maxCandidates = 0;
  const kinds = {};
  const diagnosticChoices = [];
  const limit = Symbol('decisionLimit');
  async function pick(playerId, request, candidates) {
    if (decisions >= decisionLimit) throw limit;
    if (!candidates.length) throw new Error(`Empty candidates: ${request.type}`);
    decisions++;
    kinds[request.type] = (kinds[request.type] ?? 0) + 1;
    maxCandidates = Math.max(maxCandidates, candidates.length);
    const start = profile ? performance.now() : 0;
    const index = await select({ game, playerId, request, candidates });
    if (profile) timings.decisionWaitMs += performance.now() - start;
    if (!Number.isInteger(index) || index < 0 || index >= candidates.length) throw new Error(`Invalid candidate index ${index}`);
    if (process.env.XINGBEI_DIAGNOSTIC_DIR) diagnosticChoices.push({ playerId, requestType: request.type, skillId: request.skillId, candidates, index });
    return candidates[index];
  }
  async function decide(request) {
    const playerId = decisionPlayer(request);
    const value = await pick(playerId, request, timed('candidatesMs', () => decisionCandidates(game, request)));
    if (request.type === 'overflow') return game.resolveOverflowWithDecisions(playerId, value, options);
    return value;
  }
  const options = { overflow: 'defer', choose: decide, chooseResponse: decide, chooseTarget: decide, resolveOverflow: decide };
  let reason = null;
  try {
    while (!game.winner && turns < turnLimit) {
      turns++;
      const id = game.current;
      await game.beginTurn(id, { ...options, chooseWeakness: decide }, options);
      while (game.turn.needsAction()) {
        const action = await pick(id, { type: 'action' }, timed('candidatesMs', () => actionCandidates(game, id)));
        if (action.type === 'pass') game.skipExtraActions(id);
        else {
          try { await game.executeAction(id, action, options); }
          catch (error) { if (!error.actionInvalidated) throw error; }
        }
        timed('invariantsMs', () => game.assertCardLocations());
        if (!game.winner && game.players.some(player => player.pendingOverflow)) throw new Error('Unresolved overflow after action');
      }
      await game.endTurnWithDecisions(options);
      timed('invariantsMs', () => game.assertCardLocations());
    }
    if (!game.winner) reason = 'turnLimit';
  } catch (error) {
    if (error !== limit) {
      if (process.env.XINGBEI_DIAGNOSTIC_DIR) fs.writeFileSync(`${process.env.XINGBEI_DIAGNOSTIC_DIR}/failure-${seed}.json`, JSON.stringify({ seed, start, turns, decisions, error: error.stack, current: game.current, turn: game.turn.state, teams: game.teams, players: game.players.map(p => ({ id:p.id,name:p.name,team:p.team,hero:p.hero.id,state:p.hero.state,handLimit:p.handLimit,hand:p.hand,covered:p.covered,statuses:p.statuses,healing:p.healing,energy:p.energy })), choices:diagnosticChoices, deck:game.deck.map(c => c.id), discard:game.discard.map(c => c.id), cards:[...game.cards.values()], log:game.log, publicHistory:game.publicHistory }, null, 2));
      throw error;
    }
    reason = 'decisionLimit';
  }
  return { seed, start, turns, decisions, maxCandidates, kinds,
    ...(profile ? { profile: { ...timings, elapsedMs: performance.now()-started } } : {}), winner: game.winner, terminated: !!game.winner, truncated: !game.winner, truncationReason: reason,
    rewards: game.winner ? Object.fromEntries(game.players.map(player => [player.id, player.team === game.winner ? 1 : -1])) : null };
}
