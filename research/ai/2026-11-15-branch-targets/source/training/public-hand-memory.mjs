// Facts from public observations, separate from the simulator's private move log.
export class PublicHandMemory {
  constructor() {
    this.hands = new Map();
    this.events = [];
  }

  reveal(playerId, card, reason) {
    if (!this.hands.has(playerId)) this.hands.set(playerId, new Set());
    this.hands.get(playerId).add(card.id);
    this.events.push({ type: 'reveal', playerId, cardId: card.id, name: card.name, reason });
  }

  move(card, from, to, { faceShown, visibility }) {
    const publicSource = card.publicIdentity || from.zone === 'field' ||
      (from.zone === 'discard' && card.discardVisibility === 'public') ||
      (from.zone === 'covered' && card.coveredVisibility === 'public') ||
      (from.zone === 'status' && !card.attachment?.data?.hidden);
    if (from.zone === 'hand') {
      const known = this.hands.get(from.playerId);
      const visible = card.publicIdentity || faceShown || to.zone === 'field' ||
        (['discard', 'status'].includes(to.zone) && visibility === 'public');
      if (known?.size && !visible) {
        // Even if the engine knows which card left, an observer cannot exclude
        // any previously shown card. Keep the old reveal as historical evidence.
        known.clear();
        this.events.push({ type: 'unknownDeparture', playerId: from.playerId });
      } else if (known?.delete(card.id)) {
        this.events.push({ type: 'left', playerId: from.playerId, cardId: card.id });
      }
    }
    if (to.zone === 'hand' && (publicSource || faceShown)) this.reveal(to.playerId, card, 'publicMove');
  }

  knows(playerId, card) {
    return card.publicIdentity || this.hands.get(playerId)?.has(card.id);
  }
}
