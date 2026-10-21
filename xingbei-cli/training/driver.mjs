import { Game } from '../src/engine.js';
import { actionCandidates, decisionCandidates, decisionPlayer } from './candidates.mjs';

// Trusted simulator-side callback. Raw game/request never crosses into the
// learner: a separate encoder must construct its detached observation.
export async function driveGame({ seed, heroIds, start = 0, turnLimit = 500, decisionLimit = 10000 }, select) {
  const game = new Game({ seed, ...(heroIds ? { heroIds } : {}) }).setup();
  game.current = start;
  game.automaticDecision = request => { throw new Error(`Forbidden automatic fallback: ${request.type}`); };
  let decisions = 0, turns = 0, maxCandidates = 0;
  const kinds = {};
  const limit = Symbol('decisionLimit');
  async function pick(playerId, request, candidates) {
    if (decisions >= decisionLimit) throw limit;
    if (!candidates.length) throw new Error(`Empty candidates: ${request.type}`);
    decisions++;
    kinds[request.type] = (kinds[request.type] ?? 0) + 1;
    maxCandidates = Math.max(maxCandidates, candidates.length);
    const index = await select({ game, playerId, request, candidates });
    if (!Number.isInteger(index) || index < 0 || index >= candidates.length) throw new Error(`Invalid candidate index ${index}`);
    return candidates[index];
  }
  async function decide(request) {
    const playerId = decisionPlayer(request);
    const value = await pick(playerId, request, decisionCandidates(game, request));
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
        const action = await pick(id, { type: 'action' }, actionCandidates(game, id));
        if (action.type === 'pass') game.skipExtraActions(id);
        else {
          try { await game.executeAction(id, action, options); }
          catch (error) { if (!error.actionInvalidated) throw error; }
        }
        game.assertCardLocations();
        if (game.players.some(player => player.pendingOverflow)) throw new Error('Unresolved overflow after action');
      }
      await game.endTurnWithDecisions(options);
      game.assertCardLocations();
    }
    if (!game.winner) reason = 'turnLimit';
  } catch (error) {
    if (error !== limit) throw error;
    reason = 'decisionLimit';
  }
  return { seed, turns, decisions, maxCandidates, kinds, winner: game.winner, terminated: !!game.winner, truncated: !game.winner, truncationReason: reason,
    rewards: game.winner ? Object.fromEntries(game.players.map(player => [player.id, player.team === game.winner ? 1 : -1])) : null };
}
