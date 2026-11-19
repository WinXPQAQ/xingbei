import { estimateHeroCapabilities } from './hero-capabilities.js';

// Versioned input features, not action scores or legality rules. The count-only
// channel deliberately makes no inference about hidden card identities.
export const ACTION_CAPABILITY_NUMBERS = Object.freeze([
  'abilityCountEstimate', 'abilityHandSpace', 'abilityOverflow', 'abilityPurchaseHandRoom',
  'abilityOwnKnown', 'abilityKnownAttacks', 'abilityKnownSpells', 'abilityKnownActiveSpells',
  'abilityAttackElements', 'abilityAttackDuplicates', 'abilityHolyLights', 'abilityDarkAttacks',
  'abilityOwnUniqueAttacks', 'abilityOwnUniqueSpells', 'abilityProfileCovered',
  'abilityNormalPlayEstimate', 'abilitySpellEstimate', 'abilitySelfDiscardEstimate',
  'abilityAllyDiscardEstimate', 'abilityEnemyDiscardEstimate', 'abilityDrawEstimate',
  'abilityExchangeEstimate', 'abilitySelfDamageDrawEstimate', 'abilityActionQuery',
  'abilityLegalAttacks', 'abilityLegalSpells', 'abilityLegalSkills',
  'abilityCanPurchase', 'abilityCanSynthesize', 'abilityCanRefine',
]);
export const ACTION_CAPABILITY_SYMBOLS = Object.freeze(ACTION_CAPABILITY_NUMBERS.map(key => `number:${key}`));

const nonnegative = value => Number.isFinite(value) ? Math.max(0, value) : 0;
const ordinaryElements = new Set(['water', 'fire', 'wind', 'thunder', 'earth']);

/**
 * Accepts an explicit observation DTO. Only the observer's hand is accessed.
 * Other players contribute public state and count; even `known` cards are
 * ignored here. Public revealed cards remain available to the main encoder.
 * Count estimates are saturating availability features, not win probabilities.
 */
export function estimateActionCapabilities(state) {
  const players = state.players.map(player => ({
    id: player.id, team: player.team, hero: player.skillIds?.length ? player.hero : 'none',
    count: nonnegative(player.count), limit: nonnegative(player.limit),
    healing: nonnegative(player.healing), energy: { ...player.energy },
    heroState: { ...player.heroState }, skillIds: [...(player.skillIds ?? [])],
    coveredCount: nonnegative(player.coveredCount), effects: player.effects ?? [],
    hand: [], known: [],
  }));
  const observer = state.players.find(player => player.id === state.observer);
  if (!observer) throw new RangeError(`Unknown capability observer: ${state.observer}`);
  const ownCards = observer.hand ?? [];
  const own = players.find(player => player.id === state.observer);
  const selfState = { observer: state.observer, teams: state.teams,
    publicBarriers: state.publicBarriers ?? [],
    players: players.map(player => player.id === own.id ? { ...player, hand: ownCards } : player) };
  const profile = estimateHeroCapabilities(selfState, own.id);
  const hand = ownCards.filter(card => !card.reserve);
  if (hand.length !== own.count) throw new Error('Own capability evaluation requires the complete hand');
  const attacks = hand.filter(card => card.type === 'attack');
  const spells = hand.filter(card => card.type === 'spell');
  const elementCounts = new Map();
  for (const card of attacks) for (const element of card.elements ?? []) {
    if (ordinaryElements.has(element)) elementCounts.set(element, (elementCounts.get(element) ?? 0) + 1);
  }
  const ownSkills = new Set(own.skillIds);
  const isOwnUnique = card => card.uniqueSkills?.some(skill => ownSkills.has(skill));
  const action = observer.action;
  const known = {
    abilityKnownAttacks: attacks.length,
    abilityKnownSpells: spells.length,
    abilityKnownActiveSpells: spells.filter(card => card.name !== 'holyLight').length,
    abilityAttackElements: elementCounts.size,
    abilityAttackDuplicates: [...elementCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0),
    abilityHolyLights: hand.filter(card => card.name === 'holyLight').length,
    abilityDarkAttacks: attacks.filter(card => card.elements?.includes('dark')).length,
    abilityOwnUniqueAttacks: attacks.filter(isOwnUnique).length,
    abilityOwnUniqueSpells: spells.filter(isOwnUnique).length,
    abilityProfileCovered: Number(profile.coverage === 'modeled'),
    abilityNormalPlayEstimate: profile.normalPlay,
    // Alternatives may share cards and energy. Keep the strongest single-target
    // opportunity instead of adding all theoretical damage together.
    abilitySpellEstimate: Math.max(0, ...profile.spellThreats.map(threat =>
      Math.max(threat.amount, ...Object.values(threat.amountByTarget ?? {})) * threat.readiness)),
    abilitySelfDiscardEstimate: profile.discard.self,
    abilityAllyDiscardEstimate: profile.discard.ally,
    abilityEnemyDiscardEstimate: profile.discard.enemy,
    abilityDrawEstimate: profile.turnover.draw,
    abilityExchangeEstimate: profile.turnover.exchange,
    abilitySelfDamageDrawEstimate: profile.turnover.selfDamageDraw,
    abilityActionQuery: Number(action != null),
    ...(action ? {
      abilityLegalAttacks: action.attacks,
      abilityLegalSpells: action.spells,
      abilityLegalSkills: action.skills,
      abilityCanPurchase: Number(action.purchase),
      abilityCanSynthesize: Number(action.synthesize),
      abilityCanRefine: Number(action.refine),
    } : {}),
  };
  return players.map(player => ({ playerId: player.id, numbers: {
    abilityCountEstimate: player.count / (player.count + 1),
    abilityHandSpace: Math.max(0, player.limit - player.count),
    abilityOverflow: Math.max(0, player.count - player.limit),
    // This is only the hand-count requirement. Actual purchasing availability
    // is supplied separately for the acting observer by the rule engine.
    abilityPurchaseHandRoom: Number(player.count <= 3),
    abilityOwnKnown: Number(player.id === own.id),
    ...(player.id === own.id ? known : {}),
  } }));
}
