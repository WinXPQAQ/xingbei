import { createDeck } from '../../../cards.js';

// Capability estimates consume a detached legal observation, never Game. These
// priors describe opportunities, not policy probabilities or hidden-card guesses.
export const capabilityElements = ['water', 'fire', 'wind', 'thunder', 'earth', 'dark', 'light'];
const deck = createDeck();
const rates = new Map();
const simpleRates = new Map();
export const finite = (value, maximum = 40) => Math.max(0, Math.min(maximum, Number.isFinite(value) ? value : 0));
export const unit = value => finite(value, 1);
const elements = (card, id) => card.traits?.[id]?.elements ?? card.elements ?? [card.element];
const fates = (card, id) => card.traits?.[id]?.fates ?? card.fates ?? [card.fate];
function matches(card, selector, id) {
  return (!selector.type || card.type === selector.type)
    && (!selector.name || card.name === selector.name)
    && (!selector.element || elements(card, id).includes(selector.element))
    && (!selector.fate || fates(card, id).includes(selector.fate))
    && (!selector.unique || (card.uniqueSkills ?? []).includes(selector.unique));
}
function rate(selector) {
  // Single-field selectors dominate (attack, spell, one element or one name).
  // Keep compound selectors on the existing exact key.
  const keys = Object.keys(selector);
  if (keys.length === 1 && typeof selector[keys[0]] === 'string') {
    const field = keys[0], value = selector[field];
    let byValue = simpleRates.get(field);
    if (!byValue) simpleRates.set(field, byValue = new Map());
    if (!byValue.has(value)) byValue.set(value, deck.filter(card => matches(card, selector)).length / deck.length);
    return byValue.get(value);
  }
  const key = JSON.stringify(selector);
  if (!rates.has(key)) rates.set(key, deck.filter(card => matches(card, selector)).length / deck.length);
  return rates.get(key);
}
function binomialTail(count, p, minimum) {
  if (minimum <= 0) return 1;
  if (minimum > count || !p) return 0;
  if (p >= 1) return 1;
  let term = (1 - p) ** count, below = term;
  for (let k = 1; k < minimum; k++) {
    term *= (count - k + 1) / k * p / (1 - p);
    below += term;
  }
  return unit(1 - below);
}

export function capabilityContext(state, player) {
  const count = Math.floor(finite(player.count));
  // Deliberately ignore other seats' hand arrays, even if a caller accidentally
  // supplies them. `known` contains only cards legitimately revealed to observer.
  const supplied = player.id === state.observer ? player.hand ?? [] : player.known ?? [];
  const reserves = supplied.filter(card => card.reserve);
  const known = supplied.filter(card => !card.reserve).slice(0, count);
  const unknown = count - known.length;
  const chance = (selector, minimum = 1) => {
    for (const card of known) if (matches(card, selector, player.id)) minimum--;
    if (minimum <= 0) return 1;
    if (minimum > unknown) return 0;
    return binomialTail(unknown, rate(selector), minimum);
  };
  // The planner may append legally playable covered cards (e.g. elf blessings).
  // They can enable a play but never count as hand cards or hand-discard payment.
  const playChance = selector => reserves.some(card => matches(card, selector, player.id)) ? 1 : chance(selector);
  const expected = selector => known.filter(card => matches(card, selector, player.id)).length + unknown * rate(selector);
  const groupChance = (kind = 'element', minimum = 2) => {
    const values = kind === 'fate' ? ['H', 'Y', 'J', 'S', 'X'] : capabilityElements;
    // Maximum group opportunity avoids counting overlapping pairs as independent.
    return Math.max(0, ...values.map(value => chance({ [kind]: value }, minimum)));
  };
  const groupCount = (kind = 'element') => Math.max(0, ...(kind === 'fate' ? ['H', 'Y', 'J', 'S', 'X'] : capabilityElements).map(value => expected({ [kind]: value })));
  const enemies = state.players.filter(p => p.team !== player.team);
  const allies = state.players.filter(p => p.team === player.team && p.id !== player.id);
  const others = state.players.filter(p => p.id !== player.id);
  const seat = state.players.findIndex(p => p.id === player.id);
  const nearest = direction => {
    const n = state.players.length;
    for (let i = 1; i < n; i++) {
      const other = state.players[(seat + direction * i + n) % n];
      if (other.team !== player.team) return other.id;
    }
  };
  const nextEnemy = nearest(1), previousEnemy = nearest(-1);
  const relayTargets = [...new Set([nextEnemy, previousEnemy])].filter(id => id != null);
  const gem = finite(player.energy?.gem), energy = gem + finite(player.energy?.crystal);
  const threat = (skillId, amount, readiness = 1, options = {}) => ({
    skillId, amount, readiness, targeting: 'enemy', targets: enemies.map(p => p.id),
    targetCount: 1, shieldable: false, route: 'action', ...options,
  });
  return {
    state, p: player, hs: player.heroState ?? {}, count, known, unknown, reserves,
    chance, playChance, expected, groupChance, groupCount, enemies, allies, others, relayTargets, nextEnemy,
    gem, energy, gemReady: Number(gem > 0), energyReady: Number(energy > 0),
    attack: chance({ type: 'attack' }), spell: chance({ type: 'spell' }),
    threat, basicEffects: target => (target.effects ?? []).filter(effect =>
      (effect.category ?? effect.card?.category) === 'basic'
      || ['poison', 'weakness', 'holyShield', 'powerBlessing', 'speedBlessing', 'tricky', 'waterSeal', 'fireSeal', 'windSeal', 'thunderSeal', 'earthSeal'].includes(effect.name)).length,
  };
}

export function basicCapabilities(ctx) {
  const { playChance, nextEnemy } = ctx;
  return {
    normalPlay: unit(ctx.attack + ctx.spell * .5),
    spellThreats: [
      ctx.threat('magicBullet', 2, playChance({ name: 'magicBullet' }), { targets: nextEnemy == null ? [] : [nextEnemy], shieldable: true, responseKind: 'magic' }),
      ctx.threat('poison', 1, playChance({ name: 'poison' }) * .3, { delayed: true }),
    ],
    drawThreats: [], discard: { self: 0, ally: 0, enemy: 0 },
    turnover: { draw: 0, exchange: 0, selfDamageDraw: 0 },
  };
}
