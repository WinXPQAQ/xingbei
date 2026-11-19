import { hiddenEffectFor } from "../../src/card-visibility.js";
import { playableCards } from "../../src/playable-cards.js";
import { describeActivationInteractions } from "../../src/ai/activation-interactions.js";
import { estimateActionCapabilities } from '../../src/ai/action-capability.js';
import { declaredState } from './hero-state.mjs';
import { publicBeliefs } from '../../src/ai/public-history.js';

// entities-v7 additions (zero-initialized in migrated checkpoints):
// - per player: public evidence that they lack an element (no hidden state;
//   'unanswered' attacks and public departures, as in the rule AI's beliefs);
// - observer only: shape of the own hand for set-based skills (largest
//   same-element group, number of distinct elements over all own cards).
const BELIEF_ELEMENTS = ['water', 'fire', 'wind', 'thunder', 'earth', 'light'];
export const SHAPE_SYMBOLS = ['number:handSameGroup', 'number:handDistinct',
  ...BELIEF_ELEMENTS.map(element => `number:missing_${element}`)];
function handShape(game, player) {
  const counts = new Map();
  for (const card of player.hand) for (const element of card.getTraits({ game, playerId: player.id }).elements)
    counts.set(element, (counts.get(element) ?? 0) + 1);
  return { handSameGroup: Math.max(0, ...counts.values()), handDistinct: counts.size };
}

export const ENTITY_SCHEMA = 'entities-v7';
const snapshotKeys = new WeakMap();
export const entitySnapshotKey = observation => snapshotKeys.get(observation);
// Trusted boundary. Only explicitly visible fields leave this module. Entity
// references are local array offsets, never engine card IDs or deck positions.
function buildEntityState({ game, playerId, request }) {
  const entities = [], cards = new Map(), skills = new Map(), publicPlayers = [];
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
      coveredCount: p.covered.length, handCount: p.hand.length, handLimit: p.handLimit, healing: p.healing,
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
    const hidden = hiddenEffectFor(card,playerId) && !(request.playerId===playerId && request.revealedCards?.some(c=>c.id===card.id));
    const traits = hidden ? {elements:[],fates:[]} : card.getTraits({ game, playerId: owner ?? playerId });
    const pile = card.location.zone === 'covered' ? card.location.pile : null;
    const numbers = {};
    // Public notes are an ordered score: first/second/third notes determine
    // different parts of the movement, and the oldest note leaves first.
    if (pile === 'notes' && card.coveredVisibility === 'public') {
      numbers.pilePosition = game.player(owner).covered
        .filter(note => note.location.pile === 'notes').findIndex(note => note.id === card.id);
    }
    const index = add('card', { name: hidden ? "hiddenEffect" : card.name, type: hidden ? null : card.type, category: card.category,
      zone: card.location.zone, pile, elements: [...traits.elements], fates: [...traits.fates], uniqueSkills: hidden ? [] : [...card.uniqueSkills],
      effect: card.attachment?.effectId ?? null, sourceSkill: card.attachment?.sourceSkillId ?? null }, numbers,
      { owner: playerRef(owner), source: playerRef(card.attachment?.sourcePlayerId) });
    cards.set(card.id, index); return index;
  };
  game.player(playerId).hand.forEach(addCard);
  game.player(playerId).covered.filter(c => c.coveredVisibility !== "concealed").forEach(addCard);
  [...game.cards.values()].filter(c => c.publicIdentity).forEach(addCard);
  for (const p of game.players) p.covered.filter(c => c.coveredVisibility === 'public').forEach(addCard);
  if (request.playerId === playerId) (request.revealedCards ?? []).forEach(addCard);
  for (let offset = 0; offset < 6; offset++) game.player((playerId + offset) % 6).statuses.forEach(addCard);
  game.field.forEach(addCard);
  game.discard.filter(card => card.discardVisibility === 'public').forEach(addCard);
  for (let offset = 0; offset < 6; offset++) {
    const p = game.player((playerId + offset) % 6);
    const skillIds = [];
    for (const { skill } of p.getSkills()) {
      const id = typeof skill === 'string' ? skill : skill.id;
      skillIds.push(id);
      skills.set(`${p.id}:${id}`, add('skill', { skill: id }, {}, { owner: playerRef(p.id) }));
    }
    const fields = declaredState(p, playerId);
    publicPlayers.push({ id: p.id, team: p.team, hero: p.hero.id, skillIds, coveredCount: p.covered.length,
      heroState: Object.fromEntries(fields.filter(f => f.visibility === 'public' && ['number', 'enum', 'boolean'].includes(f.type)).map(f => [f.key, f.value])) });
    for (const field of fields) {
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
      if (field.type === 'player') refs.target = playerRef(field.value);
      if (field.type === 'players') refs.participants = field.value.map(seat);
      add('heroState', { field: field.key, value: ['enum','boolean'].includes(field.type) ? field.value : null },
        field.type === 'number' ? { value: field.value } : {}, refs);
    }
  }
  const owner = game.player(playerId);
  const knownCard = card => {
    const traits = card.getTraits({ game, playerId });
    return { name: card.name, type: card.type, elements: [...traits.elements],
      fates: [...traits.fates], uniqueSkills: [...card.uniqueSkills], reserve: card.location.zone !== 'hand' };
  };
  const actionQuery = game.turn.state?.playerId === playerId && !game.turn.state.completed && !game.turn.state.actionType;
  const legal = actionQuery ? game.legalCards(playerId) : [];
  const drawSpecial = actionQuery && game.canDrawSpecial(playerId);
  const capabilityState = {
    observer: playerId,
    teams: Object.fromEntries(Object.entries(game.teams).map(([team, data]) => [team, { morale: data.morale, cups: data.cups }])),
    publicBarriers: game.players.filter(player => player.hero.id === 'barrierMaster').map(player => ({ id: player.id,
      cards: player.covered.filter(card => card.coveredVisibility === 'public' && card.location.pile === 'barrier')
        .map(card => ({ name: card.name, elements: [...card.getTraits({ game, playerId: player.id }).elements] })) })),
    players: publicPlayers.map(player => {
      const original = game.player(player.id);
      return { ...player, count: original.hand.length, limit: original.handLimit,
        healing: original.healing, energy: { ...original.energy },
        effects: original.statuses.map(card => ({ name: card.attachment?.effectId, category: card.category })),
        ...(player.id === playerId ? { hand: playableCards(owner).filter(card => cards.has(card.id)).map(knownCard),
          action: actionQuery ? {
            attacks: legal.filter(entry => entry.card.type === 'attack').length,
            spells: legal.filter(entry => entry.card.type === 'spell').length,
            skills: game.legalSkillActions(playerId).length,
            purchase: drawSpecial,
            synthesize: drawSpecial && game.stoneCounts(owner.team).total >= 3,
            refine: game.canRefine(playerId),
          } : null } : {}),
      };
    }),
  };
  for (const capability of estimateActionCapabilities(capabilityState))
    Object.assign(entities[seat(capability.playerId)].numbers, capability.numbers);
  const beliefs = publicBeliefs(game);
  for (let offset = 0; offset < 6; offset++) {
    const id = (playerId + offset) % 6, gap = offset ? beliefs.get(id) ?? {} : {};
    for (const element of BELIEF_ELEMENTS) if (gap[element]) entities[offset].numbers[`missing_${element}`] = gap[element];
  }
  Object.assign(entities[0].numbers, handShape(game, game.player(playerId)));
  add('piles', {}, { deckCount: game.deck.length, discardCount: game.discard.length });
  const cardRef = id => {
    if (id == null) return [];
    if (!cards.has(id)) throw new Error('Request references a non-visible card');
    return [cards.get(id)];
  };
  const skillRef = (id, ownerId = playerId) => skills.has(`${ownerId}:${id}`) ? [skills.get(`${ownerId}:${id}`)] : [];
  const handIds = game.player(playerId).hand.map(card => card.id);
  const playableIds = playableCards(game.player(playerId)).map(card => card.id);
  const indexes = (values, playable = false) => values.flatMap(index => cardRef((playable ? playableIds : handIds)[index]));
  const turn = game.turn.state;
  if (turn) {
    add('turn', { phase: turn.phase, route: turn.route, actionType: turn.actionType, skipped: turn.skipped,
      usedSkills: Object.entries(turn.usedSkills ?? {}).filter(([,v]) => v).map(([key]) => {
        const match = /^(doubleEcho|manaTide):([0-5])$/.exec(key);
        return match ? `${match[1]}:${seat(Number(match[2]))}` : key;
      }),
      activationDone: turn.playerId === playerId ? turn.activationDone : null,
      seekingAction: turn.playerId === playerId ? turn.seekingAction ?? false : null,
      requiredActivationSkill: turn.playerId === playerId ? turn.requiredActivationSkill ?? null : null },
      { completed: turn.completed, attackCount: turn.attackCount }, { owner: playerRef(turn.playerId) });
    for (const [position, action] of (turn.pendingActions ?? []).entries())
      add('extraAction', { type: action.type, element: action.element, fate: action.fate, sourceSkill: action.sourceSkillId }, { position }, { owner: playerRef(turn.playerId) });
    if (turn.playerId === playerId) add('reservation', { skill: turn.reservedSkillId ?? null },
      { energy: turn.reservedEnergy ?? 0, healing: turn.reservedHealing ?? 0 },
      // Activation skills can move reserved cards before the action is revalidated.
      // Keep only currently visible references; never reveal a new hidden zone.
      { cards: (turn.reservedCardIds ?? []).filter(id => cards.has(id)).flatMap(cardRef), targets: (turn.reservedTargetIds ?? []).map(seat) });
    if (turn.playerId === playerId && turn.activationIntent) {
      const intent = turn.activationIntent;
      add('activationIntent', { type: intent.type, skill: intent.skillId ?? null, mode: intent.mode ?? null }, {}, {
        cards: intent.cardIds ? intent.cardIds.filter(id => cards.has(id)).flatMap(cardRef)
          : intent.index == null ? [] : indexes([intent.index], true),
        targets: intent.targetIds?.map(seat) ?? playerRef(intent.targetId),
        skill: skillRef(intent.skillId),
      });
    }
  }
  for (const [position, id] of (game.turn.extraTurns ?? []).entries())
    add('extraTurn', {}, { position }, { owner: playerRef(id) });
  for (const [position, id] of game.turn.followupTurns.entries()) add('followupTurn', {}, { position }, { owner: playerRef(id) });
  if (game.turn.resumePlayerId != null) add('resumeTurn', {}, {}, { owner: playerRef(game.turn.resumePlayerId) });
  const history = [];
  for (const [position, event] of (game.publicHistory?.actions ?? []).slice(-32).entries()) {
    const categorical = {}, numbers = { position }, refs = {};
    for (const key of ['type','card','elements','fates','uniqueSkills','counter','result','skillId','accepted','effectId'])
      if (event[key] !== undefined) categorical[key] = Array.isArray(event[key]) ? [...event[key]] : event[key];
    for (const key of ['amount','count','gem','crystal']) if (event[key] !== undefined) numbers[key] = event[key];
    for (const key of ['playerId','actorId','sourceId','targetId']) if (event[key] != null) refs[key.slice(0,-2)] = playerRef(event[key]);
    if (event.team != null) categorical.team = side(event.team);
    history.push({ kind: 'history', categorical, numbers, refs });
  }
  return { entities, history, cards, skills, publicPlayers, turn,
    seat, playerRef, cardRef, skillRef, indexes };
}

// Each result owns its token containers and arrays. Consumers may retain or
// modify an observation without changing a cached snapshot or another sample.
function copyEntity(token) {
  const copyFields = fields => Object.fromEntries(Object.entries(fields).map(([key, value]) =>
    [key, Array.isArray(value) ? [...value] : value]));
  return { kind: token.kind, categorical: copyFields(token.categorical),
    numbers: { ...token.numbers }, refs: copyFields(token.refs) };
}

function encodeWithState({ game, playerId, request, candidates, continuations, summaries }, state, borrowTokens = false) {
  const { cards, skills, publicPlayers, turn, seat, playerRef, cardRef, skillRef, indexes } = state;
  // The worker packs board tokens synchronously. Only the question and tail are edited.
  const entities = borrowTokens ? state.entities.slice() : state.entities.map(copyEntity);
  const add = (kind, categorical = {}, numbers = {}, refs = {}) => {
    entities.push({ kind, categorical, numbers, refs }); return entities.length - 1;
  };
  const event = game.activeTrigger;
  const context = { ...event?.context, ...request.context };
  // A played card's current owner/printed traits do not identify the selected
  // element of this attack. Resolution supplies its public, effective traits.
  const attackTraits = request.attackTraits ?? context.attackTraits;
  const contextCardId = context.card?.id ?? context.cardId;
  // Never serialize the raw context: it can contain hidden cards and callbacks.
  const flags = {};
  for (const key of ['hit','forcedHit','forceHitRequested','canCounter','canHolyLight','canDarkStrike','bloodBlade',
    'hadesTremor','puppetMissMode','disableHolyStrike','extraSpell','moraleLoss','sameElement','specialAction','soulTransfer','requiresCounterSkill'])
    if (context[key] !== undefined || request[key] !== undefined) flags[key] = request[key] ?? context[key];
  const selected = request.prefix ?? request.selectedIndices;
  const intent = request.intent ?? selected?.intent ?? null;
  const exercise = game.aiExercise;
  const question = add('question', { type: request.type, stage: request.stage ?? 'complete', skill: request.skillId ?? context.skillId ?? null,
    intent: typeof intent === 'string' ? intent : intent?.type ?? null, intentSkill: intent?.skillId ?? null,
    remainingCounts: request.remainingCounts ?? [],
    timing: event?.timing ?? null, ...flags,
    ...(exercise ? {objective:exercise.objective} : {}),
    attackElements: [...(attackTraits?.elements ?? [])], attackFates: [...(attackTraits?.fates ?? [])],
    previousAttackFates: context.previousAttackTraits?.fates ?? [],
    continuationStage: context.stage ?? null, triggered: context.triggered ?? null,
    purpose: request.purpose ?? context.purpose ?? null, damageType: context.damageType ?? (request.type === 'response' ? request.attack ? 'attack' : 'spell' : null),
    optional: !!request.optional, required: !!request.required, blocked: !!request.blockedReason, counter: request.isCounter ?? context.isCounter ?? null, shieldable: request.shieldable ?? context.shieldable ?? null },
    { ...(exercise ? {initialGems:exercise.initialGems, gemRetentionBonus:exercise.gemRetentionBonus, rewardScale:exercise.rewardScale,
      maxOwnMoraleLoss:exercise.maxOwnMoraleLoss, ownMoraleLossSoFar:exercise.startingOwnMorale-game.teams[game.player(playerId).team].morale} : {}),
      amount: request.damage ?? context.amount ?? 0, count: request.count ?? context.count ?? 0,
      selectedCount: Array.isArray(selected) ? selected.length : (selected?.selectedCardIds ?? selected?.cardIds ?? []).length,
      remainingCount: request.remainingCount ?? null,
      remainingMin: request.remainingMin ?? null, remainingMax: request.remainingMax ?? null,
      chainDepth: request.chainDepth ?? context.chainDepth ?? 0, direction: request.direction ?? 0,
      point: context.point ?? 0, sourceHandCount: context.sourceHandCount ?? 0, targetHandCount: context.targetHandCount ?? 0,
      battleRunes: context.battleRunes ?? 0, magicRunes: context.magicRunes ?? 0,
      actual: context.actual ?? 0, drawCount: context.drawCount ?? 0 },
    { actor: playerRef(request.actor?.id ?? context.actorId ?? context.sourceId),
      target: playerRef(request.target?.id ?? request.targetId ?? context.targetId),
      chainOrigin: playerRef(request.chainOriginId ?? context.chainOriginId),
      protectedTarget: playerRef(request.protectedTargetId), transferTarget: playerRef(context.transferTargetId), recipient: playerRef(request.recipientId), nextTarget: playerRef(request.nextTarget?.id),
      participants: (request.participants ?? []).map(seat),
      selectedCards: Array.isArray(selected) ? indexes(selected)
        : (selected?.selectedCardIds ?? selected?.cardIds ?? (context.selectedCardIds ?? []).filter(id => cards.has(id))).flatMap(cardRef),
      selectedTargets: (selected?.selectedTargetIds ?? selected?.targetIds ?? []).map(seat),
      card: cardRef(request.attack?.id ?? (cards.has(contextCardId) ? contextCardId : null)) });
  // Dynamic tail, never cached with the board prefix. Innermost suspended
  // sequence resumes first; amounts are declared, not post-mitigation forecasts.
  for (const [order, hit] of (game.getPendingDamage?.() ?? []).entries()) {
    add('pendingDamage', { skill: hit.skillId, damageType: hit.damageType },
      { amount: hit.amount, depth: hit.depth, order },
      { actor: playerRef(hit.sourceId), target: playerRef(hit.targetId) });
  }
  entities.push(...(borrowTokens ? state.history : state.history.map(copyEntity)));
  const candidate = value => {
    const categorical = { type: request.type }, numbers = {}, refs = {};
    if (value == null) categorical.type = 'decline';
    else if (request.type === 'action') {
      categorical.type = value.type; categorical.skill = value.skillId ?? null; categorical.mode = value.mode ?? null;
      categorical.direction = value.direction ?? null;
      categorical.intent = typeof value.intent === 'string' ? value.intent : value.intent?.type ?? null;
      categorical.intentSkill = value.intent?.skillId ?? null;
      if (value.intent?.skillId) refs.intentSkill = skillRef(value.intent.skillId);
      if (value.complete != null) categorical.finish = !!value.complete;
      numbers.selectedCount = (value.selectedCardIds ?? value.cardIds ?? []).length;
      if (value.count != null) numbers.count = value.count;
      if (value.targetCount != null) numbers.targetCount = value.targetCount;
      refs.cards = (value.selectedCardIds ?? value.cardIds)?.flatMap(cardRef) ?? (value.index == null ? [] : indexes([value.index], true));
      refs.targets = (value.selectedTargetIds ?? value.targetIds)?.map(seat) ?? playerRef(value.targetId);
      if (value.skillId && skills.has(`${playerId}:${value.skillId}`)) refs.skill = [skills.get(`${playerId}:${value.skillId}`)];
      numbers.gem = value.stones?.gem ?? value.gemCount ?? 0; numbers.crystal = value.stones?.crystal ?? 0;
    } else if (request.type === 'response') {
      refs.cards = indexes([value.index], true); refs.targets = playerRef(value.targetId);
      categorical.asAttack = !!request.valid?.find(item => item.index === value.index)?.asAttack;
    } else if (['cardChoice','overflow'].includes(request.type)) {
      refs.cards = indexes(value);
      if (request.stage === 'selectCards') categorical.finish = value.length === 0;
    }
    else if (['target','playerChoice'].includes(request.type)) refs.targets = playerRef(value);
    else if (request.type === 'effectChoice') refs.cards = cardRef(value);
    else if (request.type === 'energyChoice') { numbers.gem = value.gem; numbers.crystal = value.crystal; }
    else if (request.skillId === 'activationRoute') {
      categorical.skill = value;
      if (skills.has(`${playerId}:${value}`)) refs.skill = [skills.get(`${playerId}:${value}`)];
    }
    else if (typeof value === 'number') numbers.value = value;
    else if (['string','boolean'].includes(typeof value)) categorical.value = value;
    else throw new Error(`Unsupported candidate ${request.type}`);
    return { kind: 'candidate', categorical, numbers, refs };
  };
  if (request.prefix) {
    const token = candidate(request.prefix);
    token.kind = 'decisionPrefix';
    entities.push(token);
  }
  const encoded = candidates.map(candidate);
  // Show feasible continuations without exposing hidden state. Multi-card sets
  // stay sets; target ordering remains on the actual target-choice tokens.
  continuations?.forEach((values, index) => {
    const tokens = values.map(candidate);
    encoded[index].numbers.continuations = values.length;
    for (const role of ['cards', 'targets']) encoded[index].refs['available' + role] =
      [...new Set(tokens.flatMap(token => token.refs[role] ?? []))];
  });
  // Summaries enumerate available entities, never Cartesian products of full
  // commands. The high-level policy can inspect its continuations without
  // paying the cost of materializing every card/target/fee combination.
  summaries?.forEach((summary, index) => {
    if (!encoded[index]) throw new Error('Summary without candidate');
    const token = encoded[index];
    token.refs.availablecards = [...new Set((summary.cardIds ?? []).flatMap(cardRef))];
    token.refs.availableskills = [...new Set((summary.skillIds ?? []).flatMap(id => skillRef(id)))];
    token.refs.availabletargets = [...new Set((summary.targetIds ?? []).map(seat))];
    if (summary.count != null) token.numbers.continuations = summary.count;
    if (summary.intent != null) {
      token.categorical.intent = typeof summary.intent === 'string' ? summary.intent : summary.intent.type;
      token.categorical.intentSkill = summary.intent?.skillId ?? null;
    }
  });
  // Describe public opportunities, not predicted choices or heuristic scores.
  // Missing declarations remain explicitly incomplete, never "no interaction".
  const previews = new Map();
  const activationPreview = (actorId, intent) => {
    const description = describeActivationInteractions({ players: publicPlayers }, actorId, intent);
    const key = JSON.stringify([actorId, description]);
    if (previews.has(key)) return previews.get(key);
    const refs = [add('activationPreview', { coverage: description.coverage },
      { schemaVersion: description.schemaVersion }, { actor: playerRef(actorId) })];
    const events = description.events.map(event => add('activationEvent', {
      type: event.kind, skill: event.skillId, damageType: event.damageType ?? null, potential: true,
      optional: event.optional ?? null,
    }, { amount: event.amount ?? null }, {
      actor: playerRef(event.sourceId), target: playerRef(event.targetId), skill: skillRef(event.skillId, event.sourceId),
    }));
    refs.push(...events);
    for (const reaction of description.interactions) {
      const numbers = { coveredCount: publicPlayers.find(p => p.id === reaction.ownerId)?.coveredCount ?? 0 };
      for (const field of ['priority', 'whenActual', 'coveredCost', 'actualDelta'])
        if (Number.isFinite(reaction[field])) numbers[field] = reaction[field];
      refs.push(add('activationInteraction', { skill: reaction.skillId, timing: reaction.timing,
        condition: reaction.condition, modeled: reaction.modeled === true, optional: reaction.optional === true,
        hiddenDependent: reaction.hiddenCondition === true }, numbers, {
        owner: playerRef(reaction.ownerId), actor: playerRef(actorId), target: playerRef(reaction.targetId),
        skill: skillRef(reaction.skillId, reaction.ownerId), event: events[reaction.eventIndex] == null ? [] : [events[reaction.eventIndex]],
      }));
    }
    previews.set(key, refs);
    return refs;
  };
  candidates.forEach((value, index) => {
    if (request.type === 'action' && (value?.type === 'activate' || value?.direction === 'activate'))
      encoded[index].refs.activationPreview = activationPreview(playerId, value.intent ?? null);
  });
  if (turn?.phase === 'activation') entities[question].refs.activationPreview =
    activationPreview(turn.playerId, turn.playerId === playerId ? turn.activationIntent ?? null : null);
  return { schema: ENTITY_SCHEMA, question, entities, candidates: encoded };
}

export function encodeEntities(input) {
  return encodeWithState(input, buildEntityState(input));
}

// The decision driver supplies a new scope for each engine request. Only pure
// subchoices within that scope reuse state; callers without a scope stay uncached.
export function createEntityEncoder({ borrowTokens = false } = {}) {
  const snapshots = new WeakMap();
  return input => {
    const scope = input.decisionScope;
    if (scope == null || typeof scope !== 'object') return encodeWithState(input, buildEntityState(input), borrowTokens);
    const root = input.rootRequest ?? input.request;
    const visibility = JSON.stringify([input.request.playerId,
      (input.request.revealedCards ?? []).map(card => card.id)]);
    let cached = snapshots.get(scope);
    if (!cached || cached.game !== input.game || cached.playerId !== input.playerId
      || cached.root !== root || cached.visibility !== visibility) {
      cached = { game: input.game, playerId: input.playerId, root, visibility,
        state: buildEntityState(input), transportKey: {} };
      snapshots.set(scope, cached);
    }
    const observation = encodeWithState(input, cached.state, borrowTokens);
    snapshotKeys.set(observation, cached.transportKey);
    return observation;
  };
}
