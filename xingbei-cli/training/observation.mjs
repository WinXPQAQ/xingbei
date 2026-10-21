import { captureObservation } from '../src/ai/observation.js';

// This is the only model boundary. No raw request, log, presentation snapshot,
// card ID, engine object, or function is returned. Commands stay in the worker.
export function encodeDecision({ game, playerId, request, candidates }) {
  // Planned activation costs belong to the acting seat, not to responders.
  // Current six heroes cannot ask another seat here; fail closed if extended.
  if (game.turn.state?.playerId !== playerId && (request.reservedEnergy || request.reservedHealing)) {
    throw new Error('Private activation reservation belongs to another seat');
  }
  const data = captureObservation(game, playerId, { activation: true });
  const seat = id => id == null ? null : (id - playerId + 6) % 6;
  const ownTeam = data.players[playerId].team;
  const side = team => team === ownTeam ? 'own' : 'opponent';
  const cards = new Map(data.cards.map(card => [card.id, card]));
  const describe = id => {
    if (id == null) return null;
    const card = cards.get(id);
    if (!card) throw new Error('Non-visible card requested by model encoder');
    const owner = card.location.playerId ?? playerId;
    const traits = card.traits[owner];
    const attachment = game.cards.get(id).attachment;
    return { name: card.name, type: card.type, category: card.category,
      elements: traits.elements, fates: traits.fates, uniqueSkills: card.uniqueSkills,
      effect: card.attachment?.effectId ?? null, source: seat(attachment?.sourcePlayerId),
      zone: card.location.zone, owner: seat(card.location.playerId) };
  };
  const hand = game.player(playerId).hand;
  const fromIndex = index => describe(hand[index]?.id);
  const action = value => ({ type: value.type, skill: value.skillId ?? null, mode: value.mode ?? null,
    cards: value.cardIds?.map(describe) ?? (value.index == null ? [] : [fromIndex(value.index)]),
    targets: value.targetIds?.map(seat) ?? (value.targetId == null ? [] : [seat(value.targetId)]),
    stones: value.stones ?? null, gemCount: value.gemCount ?? null });
  const candidate = value => {
    if (value == null) return { type: 'decline' };
    switch (request.type) {
      case 'action': return action(value);
      case 'response': return { type: 'response', card: fromIndex(value.index), target: seat(value.targetId) };
      case 'cardChoice': case 'overflow': return { type: 'cards', cards: value.map(fromIndex) };
      case 'target': case 'playerChoice': return { type: 'target', target: seat(value) };
      case 'effectChoice': return { type: 'effect', card: describe(value) };
      case 'energyChoice': return { type: 'energy', gem: value.gem, crystal: value.crystal };
      default:
        if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error(`Unexpected candidate: ${request.type}`);
        return { type: request.type, value };
    }
  };
  const event = entry => {
    const out = {};
    for (const key of ['type', 'card', 'elements', 'fates', 'uniqueSkills', 'counter', 'result', 'amount', 'skillId', 'accepted', 'count', 'effectId', 'gem', 'crystal']) {
      if (entry[key] !== undefined) out[key] = entry[key];
    }
    for (const key of ['playerId', 'actorId', 'sourceId', 'targetId']) if (entry[key] != null) out[key.replace('Id', '')] = seat(entry[key]);
    if (entry.team != null) out.team = side(entry.team);
    return out;
  };
  const context = request.context ?? {};
  const output = {
    schema: 2,
    current: seat(data.current),
    players: Array.from({ length: 6 }, (_, offset) => {
      const player = data.players[(playerId + offset) % 6];
      return { hero: player.hero.id, team: side(player.team), handCount: player.handCount, handLimit: player.handLimit,
        healing: player.healing, healingLimit: player.healingLimit, energy: player.energy, skills: player.skillIds,
        hand: player.handIds?.map(describe) ?? null, statuses: player.statusIds.map(describe) };
    }),
    teams: Object.fromEntries(Object.entries(data.teams).map(([team, value]) => [side(team), value])),
    turn: data.turn ? { player: seat(data.turn.playerId), completed: data.turn.completed, attackCount: data.turn.attackCount,
      pendingActions: data.turn.pendingActions, usedSkills: data.turn.usedSkills,
      activationDone: data.turn.activationDone, reservedEnergy: data.turn.reservedEnergy, reservedHealing: data.turn.reservedHealing } : null,
    field: data.cards.filter(card => card.location.zone === 'field').map(card => describe(card.id)),
    history: data.publicHistory?.actions?.map(event) ?? [],
    request: { type: request.type, skill: request.skillId ?? null, purpose: request.purpose ?? null,
      actor: seat(request.actor?.id), target: seat(request.target?.id ?? request.targetId ?? context.targetId),
      recipient: seat(request.recipientId), nextTarget: seat(request.nextTarget?.id),
      attack: describe(request.attack?.id ?? context.card?.id),
      amount: request.damage ?? context.amount ?? null, damageType: context.damageType ?? null,
      shieldable: request.shieldable ?? null, counter: request.isCounter ?? null,
      count: request.count ?? null, optional: request.optional ?? false,
      reservedEnergy: request.reservedEnergy ?? null, reservedHealing: request.reservedHealing ?? null },
    candidates: candidates.map(candidate),
  };
  return JSON.parse(JSON.stringify(output));
}
