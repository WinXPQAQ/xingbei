import { declaredState } from './hero-state.mjs';

export const ENTITY_SCHEMA = 'entities-v2';
// Trusted boundary. Only explicitly visible fields leave this module. Entity
// references are local array offsets, never engine card IDs or deck positions.
export function encodeEntities({ game, playerId, request, candidates }) {
  const entities = [], cards = new Map(), skills = new Map();
  const seat = id => (id - playerId + 6) % 6;
  const playerRef = id => id == null ? [] : [seat(id)];
  const ownTeam = game.player(playerId).team;
  const side = team => team === ownTeam ? 'own' : 'opponent';
  const add = (kind, categorical = {}, numbers = {}, refs = {}) => {
    entities.push({ kind, categorical, numbers, refs }); return entities.length - 1;
  };
  for (let offset = 0; offset < 6; offset++) {
    const p = game.player((playerId + offset) % 6);
    add('player', { hero: p.hero.id, team: side(p.team) }, { seat: offset,
      handCount: p.hand.length, handLimit: p.handLimit, healing: p.healing,
      healingLimit: game.getHealingLimit(p.id), energyLimit: game.getEnergyLimit(p.id),
      gem: p.energy.gem, crystal: p.energy.crystal });
  }
  for (const [team, data] of Object.entries(game.teams)) {
    add('team', { team: side(team) }, { morale: data.morale, cups: data.cups,
      gem: game.stoneCounts(team).gem, crystal: game.stoneCounts(team).crystal });
  }
  const addCard = card => {
    if (cards.has(card.id)) return cards.get(card.id);
    const owner = card.location.playerId;
    const traits = card.getTraits({ game, playerId: owner ?? playerId });
    const index = add('card', { name: card.name, type: card.type, category: card.category,
      zone: card.location.zone, elements: [...traits.elements], fates: [...traits.fates], uniqueSkills: [...card.uniqueSkills],
      effect: card.attachment?.effectId ?? null, sourceSkill: card.attachment?.sourceSkillId ?? null }, {},
      { owner: playerRef(owner), source: playerRef(card.attachment?.sourcePlayerId) });
    cards.set(card.id, index); return index;
  };
  game.player(playerId).hand.forEach(addCard);
  for (let offset = 0; offset < 6; offset++) game.player((playerId + offset) % 6).statuses.forEach(addCard);
  for (let offset = 0; offset < 6; offset++) {
    const p = game.player((playerId + offset) % 6);
    for (const { skill } of p.getSkills()) {
      const id = typeof skill === 'string' ? skill : skill.id;
      skills.set(`${p.id}:${id}`, add('skill', { skill: id }, {}, { owner: playerRef(p.id) }));
    }
    for (const field of declaredState(p, playerId)) {
      const refs = { owner: playerRef(p.id) };
      // Current card state reference is the publicly created fivefold binding.
      // Future private card references must declare owner visibility.
      if (field.type === 'card' && field.value != null) {
        const card = game.cards.get(field.value);
        if (!card || (card.location.zone !== 'outside' && !cards.has(card.id))) {
          throw new Error(`State references non-visible card: ${field.key}`);
        }
        refs.card = [addCard(card)];
      }
      add('heroState', { field: field.key, value: ['enum','boolean'].includes(field.type) ? field.value : null },
        field.type === 'number' ? { value: field.value } : {}, refs);
    }
  }
  game.field.forEach(addCard);
  game.discard.filter(card => card.discardVisibility === 'public').forEach(addCard);
  add('piles', {}, { deckCount: game.deck.length, discardCount: game.discard.length });
  const cardRef = id => {
    if (id == null) return [];
    if (!cards.has(id)) throw new Error('Request references a non-visible card');
    return [cards.get(id)];
  };
  const indexes = values => values.flatMap(index => cardRef(game.player(playerId).hand[index]?.id));
  const turn = game.turn.state;
  if (turn) {
    add('turn', { phase: turn.phase, route: turn.route, actionType: turn.actionType, skipped: turn.skipped,
      usedSkills: Object.entries(turn.usedSkills ?? {}).filter(([,v]) => v).map(([k]) => k),
      activationDone: turn.playerId === playerId ? turn.activationDone : null },
      { completed: turn.completed, attackCount: turn.attackCount }, { owner: playerRef(turn.playerId) });
    for (const [position, action] of (turn.pendingActions ?? []).entries())
      add('extraAction', { type: action.type, element: action.element, sourceSkill: action.sourceSkillId }, { position }, { owner: playerRef(turn.playerId) });
    if (turn.playerId === playerId) add('reservation', { skill: turn.reservedSkillId ?? null },
      { energy: turn.reservedEnergy ?? 0, healing: turn.reservedHealing ?? 0 },
      { cards: (turn.reservedCardIds ?? []).flatMap(cardRef), targets: (turn.reservedTargetIds ?? []).map(seat) });
  }
  const event = game.activeTrigger;
  const context = { ...event?.context, ...request.context };
  // Never serialize the raw context: it can contain hidden cards and callbacks.
  const flags = {};
  for (const key of ['hit','forcedHit','forceHitRequested','canCounter','canHolyLight','bloodBlade',
    'hadesTremor','puppetMissMode','disableHolyStrike','extraSpell','moraleLoss','sameElement','specialAction'])
    if (context[key] !== undefined || request[key] !== undefined) flags[key] = request[key] ?? context[key];
  const question = add('question', { type: request.type, skill: request.skillId ?? null,
    timing: event?.timing ?? null, ...flags,
    purpose: request.purpose ?? context.purpose ?? null, damageType: context.damageType ?? (request.type === 'response' ? request.attack ? 'attack' : 'spell' : null),
    optional: !!request.optional, counter: request.isCounter ?? context.isCounter ?? null, shieldable: request.shieldable ?? context.shieldable ?? null },
    { amount: request.damage ?? context.amount ?? 0, count: request.count ?? context.count ?? 0,
      chainDepth: request.chainDepth ?? context.chainDepth ?? 0, direction: request.direction ?? 0,
      point: context.point ?? 0, sourceHandCount: context.sourceHandCount ?? 0, targetHandCount: context.targetHandCount ?? 0,
      battleRunes: context.battleRunes ?? 0, magicRunes: context.magicRunes ?? 0,
      actual: context.actual ?? 0, drawCount: context.drawCount ?? 0 },
    { actor: playerRef(request.actor?.id ?? context.actorId ?? context.sourceId),
      target: playerRef(request.target?.id ?? request.targetId ?? context.targetId),
      chainOrigin: playerRef(request.chainOriginId ?? context.chainOriginId),
      recipient: playerRef(request.recipientId), nextTarget: playerRef(request.nextTarget?.id),
      participants: (request.participants ?? []).map(seat),
      card: cardRef(request.attack?.id ?? (cards.has(context.card?.id) ? context.card.id : null)) });
  for (const [position, event] of (game.publicHistory?.actions ?? []).slice(-32).entries()) {
    const categorical = {}, numbers = { position }, refs = {};
    for (const key of ['type','card','elements','fates','uniqueSkills','counter','result','skillId','accepted','effectId'])
      if (event[key] !== undefined) categorical[key] = Array.isArray(event[key]) ? [...event[key]] : event[key];
    for (const key of ['amount','count','gem','crystal']) if (event[key] !== undefined) numbers[key] = event[key];
    for (const key of ['playerId','actorId','sourceId','targetId']) if (event[key] != null) refs[key.slice(0,-2)] = playerRef(event[key]);
    if (event.team != null) categorical.team = side(event.team);
    add('history', categorical, numbers, refs);
  }
  const candidate = value => {
    const categorical = { type: request.type }, numbers = {}, refs = {};
    if (value == null) categorical.type = 'decline';
    else if (request.type === 'action') {
      categorical.type = value.type; categorical.skill = value.skillId ?? null; categorical.mode = value.mode ?? null;
      refs.cards = value.cardIds?.flatMap(cardRef) ?? (value.index == null ? [] : indexes([value.index]));
      refs.targets = value.targetIds?.map(seat) ?? playerRef(value.targetId);
      if (value.skillId && skills.has(`${playerId}:${value.skillId}`)) refs.skill = [skills.get(`${playerId}:${value.skillId}`)];
      numbers.gem = value.stones?.gem ?? value.gemCount ?? 0; numbers.crystal = value.stones?.crystal ?? 0;
    } else if (request.type === 'response') {
      refs.cards = indexes([value.index]); refs.targets = playerRef(value.targetId);
    } else if (['cardChoice','overflow'].includes(request.type)) refs.cards = indexes(value);
    else if (['target','playerChoice'].includes(request.type)) refs.targets = playerRef(value);
    else if (request.type === 'effectChoice') refs.cards = cardRef(value);
    else if (request.type === 'energyChoice') { numbers.gem = value.gem; numbers.crystal = value.crystal; }
    else if (typeof value === 'number') numbers.value = value;
    else if (['string','boolean'].includes(typeof value)) categorical.value = value;
    else throw new Error(`Unsupported candidate ${request.type}`);
    return { kind: 'candidate', categorical, numbers, refs };
  };
  return { schema: ENTITY_SCHEMA, question, entities, candidates: candidates.map(candidate) };
}
