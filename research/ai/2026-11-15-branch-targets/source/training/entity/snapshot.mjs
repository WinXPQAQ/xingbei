// Restore a recorded game state into a live engine (human game snapshots).
// The restored game includes hidden cards as recorded; callers that search
// from it must resample what the searching seat cannot see.
import assert from 'node:assert/strict';
import { Game } from '../../src/engine.js';

export function restoreSnapshot(config, s) {
  const g = new Game({ ...config, ruleVariant: 'standard' });
  for (const p of s.players) {
    assert.equal(g.player(p.id).hero.id, p.hero.id);
    Object.assign(g.player(p.id).hero.state, structuredClone(p.hero.state));
    g.player(p.id).healing = p.healing; g.player(p.id).energy = { ...p.energy }; g.player(p.id).pendingOverflow = p.pendingOverflow;
  }
  assert.equal(g.cards.size, s.cards.length);
  for (const c of [...g.cards.values()]) g.moveCard(c.id, { zone: 'outside' });
  for (const c of s.cards) {
    assert.ok(g.cards.has(c.id));
    const card = g.cards.get(c.id);
    card.attachment = structuredClone(c.attachment);
    g.moveCard(c.id, c.location, { animate: false });
    card.coveredVisibility = c.coveredVisibility; card.discardVisibility = c.discardVisibility;
  }
  // Restore order within registered zones, without changing their membership.
  const order = (zone, ids) => {
    assert.deepEqual([...zone.map(c => c.id)].sort(), [...ids].sort());
    const rank = new Map(ids.map((id, i) => [id, i]));
    zone.sort((a, b) => rank.get(a.id) - rank.get(b.id));
  };
  for (const p of s.players) {
    const current = g.player(p.id);
    order(current.hand, p.hand.map(c => c.id)); order(current.covered, p.covered.map(c => c.id));
    assert.equal(current.handLimit, p.handLimit);
  }
  for (const zone of ['deck', 'discard', 'field', 'outside']) order(g[zone], s[zone]);
  g.current = s.current; g.winner = s.winner; g.teams = structuredClone(s.teams); g.turn.state = structuredClone(s.turn);
  g.turn.extraTurns = structuredClone(s.extraTurns ?? []); g.turn.followupTurns = structuredClone(s.followupTurns ?? []);
  g.turn.resumePlayerId = s.resumePlayerId;
  Object.assign(g.publicHistory, structuredClone(s.publicHistory));
  g.pendingRuleEvents = []; g.assertCardLocations();
  return g;
}
