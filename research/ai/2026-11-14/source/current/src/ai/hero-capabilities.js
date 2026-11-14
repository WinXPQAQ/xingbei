import { capabilityContext, basicCapabilities, finite, unit } from '../heroes/shared/ai/capabilities.js';
import sealer from '../heroes/sealer/capabilities.js';
import spiritTide from '../heroes/spirit-tide/capabilities.js';
import adventurer from '../heroes/adventurer/capabilities.js';
import magicSwordsman from '../heroes/magic-swordsman/capabilities.js';
import plagueMage from '../heroes/plague-mage/capabilities.js';
import mischiefGirl from '../heroes/mischief-girl/capabilities.js';
import magicArcher from '../heroes/magic-archer/capabilities.js';
import magicLancer from '../heroes/magic-lancer/capabilities.js';
import heretic from '../heroes/heretic/capabilities.js';
import yinYangMaster from '../heroes/yin-yang-master/capabilities.js';
import chronicler from '../heroes/chronicler/capabilities.js';
import soulWarlock from '../heroes/soul-warlock/capabilities.js';
import bard from '../heroes/bard/capabilities.js';
import barrierMaster from '../heroes/barrier-master/capabilities.js';
import redLotusKnight from '../heroes/red-lotus-knight/capabilities.js';
import elementalist from '../heroes/elementalist/capabilities.js';
import marksman from '../heroes/marksman/capabilities.js';
import magicArcherEX from '../heroes/magic-archer-ex/capabilities.js';
import azureFlameWitch from '../heroes/azure-flame-witch/capabilities.js';
import sage from '../heroes/sage/capabilities.js';
import prayer from '../heroes/prayer/capabilities.js';
import priest from '../heroes/priest/capabilities.js';
import magicalGirl from '../heroes/magical-girl/capabilities.js';
import bloodSwordSpirit from '../heroes/blood-sword-spirit/capabilities.js';
import adjudicator from '../heroes/adjudicator/capabilities.js';
import defiler from '../heroes/defiler/capabilities.js';
import apprenticeProducer from '../heroes/apprentice-producer/capabilities.js';

const profiles = Object.freeze({ sealer, spiritTide, adventurer, magicSwordsman, plagueMage,
  mischiefGirl, magicArcher, magicLancer, heretic, yinYangMaster, chronicler, soulWarlock,
  bard, barrierMaster, redLotusKnight, elementalist, marksman, magicArcherEX,
  azureFlameWitch, sage, prayer, priest, magicalGirl, apprenticeProducer });

// Explicit registry coverage: unmodeled does NOT mean harmless. Adding a hero
// requires declaring either its profile or its baseline-only status here.
export const CAPABILITY_HERO_IDS = Object.freeze([
  'mischiefGirl', 'holyAdjudicator', 'orchestraLeader', 'swordChild', 'slothGirl',
  'spiritTide', 'gluttonousGirl', 'trickAdventurer', 'primalArcher', 'trickHolyArcher',
  'enviousGirl', 'ranger', 'magicArcherEX', 'apprenticeProducer', 'delinquentGirl',
  'curseTalisman', 'greedyGirl', 'holidayMage', 'godEater', 'lawgiver', 'cardinal',
  'chronicler', 'missionary', 'heretic', 'nobleLady', 'headMaid', 'barrierMaster',
  'mystic', 'defiler', 'swordWitch', 'butterflyDancer', 'battleMage', 'starfallWitch',
  'inquisitor', 'witchHunter', 'templar', 'elfArcher', 'yinYangMaster', 'soulWarlock',
  'bloodWitch', 'moonGoddess', 'holyArcher', 'talismanMaster', 'swordEmperor',
  'magicArcher', 'azureFlameWitch', 'bloodSwordSpirit', 'beastWarrior', 'adventurer',
  'fighter', 'brave', 'redLotusKnight', 'magicLancer', 'bard', 'assassin',
  'magicSwordsman', 'adjudicator', 'sage', 'prayer', 'heroicPuppet', 'saint', 'holyLancer',
  'plagueMage', 'elementalist', 'valkyrie', 'magicalGirl', 'priest', 'guardianAngel',
  'sealer', 'marksman', 'windSwordmaster', 'berserker',
]);
const registered = new Set(CAPABILITY_HERO_IDS);
export const capabilityCoverage = Object.freeze(Object.fromEntries(CAPABILITY_HERO_IDS.map(id => [id, profiles[id] ? 'modeled' : 'baseline-only'])));

/** Public opportunities, in cards/damage units; not a policy or legality oracle.
 * Same route names are mutually exclusive choices. A multi-target threat is one
 * action, not separate casts. Different routes can still share scarce resources;
 * consumers must discount them instead of blindly summing all capacities.
 * `readiness` is an uncalibrated opportunity weight, NOT a win/hit probability.
 */
export function estimateHeroCapabilities(state, playerId) {
  const player = state.players.find(p => p.id === playerId);
  if (!player) throw new RangeError(`Unknown capability player: ${playerId}`);
  const ctx = capabilityContext(state, player), baseline = basicCapabilities(ctx);
  const profile = profiles[player.hero]?.(ctx) ?? {};
  const coverage = capabilityCoverage[player.hero] ?? 'unknown';
  const normalizeThreat = threat => ({ ...threat,
    amount: finite(threat.amount), readiness: unit(threat.readiness),
    targetCount: Math.max(1, Math.min(state.players.length, Math.floor(threat.targetCount ?? 1))),
    targets: [...new Set(threat.targets ?? [])].filter(id => state.players.some(p => p.id === id)),
    ...(threat.amountByTarget ? { amountByTarget: Object.fromEntries(Object.entries(threat.amountByTarget).map(([id, amount]) => [id, finite(amount)])) } : {}),
  });
  const discard = Object.fromEntries(['self', 'ally', 'enemy'].map(key => [key, finite(profile.discard?.[key]) ]));
  const turnover = Object.fromEntries(['draw', 'exchange', 'selfDamageDraw'].map(key => [key, finite(profile.turnover?.[key]) ]));
  const normalPlay = finite(profile.normalPlay ?? baseline.normalPlay);
  // An outgoing capacity may consume the action instead of ordinary play. Keep
  // alternatives apart; high drawing is explicitly *incoming*, never relief.
  const outgoing = Math.max(normalPlay, discard.self), incoming = Math.max(turnover.draw, turnover.selfDamageDraw);
  return {
    hero: player.hero, coverage, uncertain: coverage !== 'modeled',
    spellThreats: [...(profile.basicMagic === false ? [] : baseline.spellThreats), ...(profile.spellThreats ?? [])].map(normalizeThreat).filter(t => t.readiness > 0 && t.targets.length && (t.amount > 0 || t.amountByTarget)),
    drawThreats: (profile.drawThreats ?? []).map(normalizeThreat).filter(t => t.readiness > 0 && t.targets.length),
    discard, turnover, normalPlay,
    flow: { outgoing, incoming, exchange: turnover.exchange },
    notes: profile.notes ?? [registered.has(player.hero) ? '仅基本牌公共先验；英雄专属机制尚未建模，不能解释为没有法伤或弃牌能力。' : '未知英雄：保留基本牌公共先验，能力不完整。'],
  };
}

export function estimateAllHeroCapabilities(state) {
  return state.players.map(player => ({ playerId: player.id, ...estimateHeroCapabilities(state, player.id) }));
}
