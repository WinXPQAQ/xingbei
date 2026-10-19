// Observation only: never stores hidden card identities, hidden traits, or deck order.
// Kept separately from presentation snapshots (which contain private hands).
export class PublicHistory {
  constructor(limit = 256) { this.limit = limit; this.sequence = 0; this.events = []; }
  append(event) {
    this.events.push(Object.freeze({ ...event, sequence: ++this.sequence }));
    if (this.events.length > this.limit) this.events.shift();
  }
  move(from, to, publicTraits = null) {
    if (from.zone === 'hand') this.append({ type: 'leave', playerId: from.playerId, elements: publicTraits ? Object.freeze([...publicTraits.elements]) : null });
    if (to.zone === 'hand') this.append({ type: 'gain', playerId: to.playerId });
  }
  attack(context) {
    // Forced hits, lightning/storm restrictions and shields are not evidence of a missing element.
    if (context.forcedHit || !context.canCounter || context.card.name === 'darkStrike') return;
    this.append({ type: 'unanswered', playerId: context.targetId, elements: Object.freeze([...context.attackTraits.elements]) });
  }
}

const cache = new WeakMap();
export function publicBeliefs(game) {
  const history = game.publicHistory;
  if (!history) return new Map();
  const previous = cache.get(history);
  if (previous?.sequence === history.sequence) return previous.beliefs;
  // Recompute a bounded window; no persistence across games, resets or hidden-state access.
  const beliefs = new Map();
  for (const event of history.events) {
    if (event.type === 'turn') {
      for (const gap of beliefs.values()) for (const key of Object.keys(gap)) gap[key] *= 0.92;
      continue;
    }
    if (!beliefs.has(event.playerId)) beliefs.set(event.playerId, {});
    const gap = beliefs.get(event.playerId);
    const decay = event.type === 'gain' ? 0.62 : event.type === 'leave' ? 0.88 : 1;
    for (const key of Object.keys(gap)) gap[key] *= decay;
    if (event.type === 'unanswered') {
      for (const element of event.elements) gap[element] = Math.min(0.7, (gap[element] ?? 0) + 0.35 * (1 - (gap[element] ?? 0)));
      gap.light = Math.min(0.5, (gap.light ?? 0) + 0.12);
    } else if (event.type === 'leave' && event.elements) {
      for (const element of event.elements) gap[element] = Math.min(0.7, (gap[element] ?? 0) + 0.10);
    }
  }
  cache.set(history, { sequence: history.sequence, beliefs });
  return beliefs;
}
