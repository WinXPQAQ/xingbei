import { estimateHeroCapabilities } from '../../ai/hero-capabilities.js';
import { aiFor } from '../shared/ai/base/registry.js';

const ownCards = player => player.hand.filter(card => !card.reserve);
const attackCount = player => ownCards(player).filter(card => card.type === 'attack').length;

// Only public seats, resources and forms enter this estimate. A large hand
// improves response coverage; ordinary non-overflow damage is not a penalty.
export function formExposure(state, id, { form = true, malice = 1, count = state.players[id].count } = {}) {
  const player = state.players[id], seats = state.players.length;
  const current = state.current ?? id;
  const start = current === id ? (current + 1) % seats : current;
  let exposure = 0;
  for (let step = 0; step < seats; step++) {
    const source = state.players[(start + step) % seats];
    if (source.id === id) break;
    if (source.team === player.team) continue;
    const readiness = 1 - .3 ** source.count;
    const amount = aiFor(source).riskDamage?.(source) ?? 2 + .5 * Number(source.energy.gem > 0) + .75 * Number(Boolean(source.heroState.form));
    const actual = form && malice > 0 ? Math.min(4, amount + 1) : amount;
    const hasLight = ownCards(player).some(card => card.name === 'holyLight');
    const defenses = attackCount(player) + Number(!form && hasLight);
    const response = .78 ** Math.max(defenses, count * .45);
    const attackLoss = Math.max(0, count + actual - player.limit) * readiness * response;
    const capabilities = estimateHeroCapabilities(state, source.id);
    let spellLoss = 0;
    for (const threat of [...capabilities.spellThreats, ...capabilities.drawThreats]) {
      if (!threat.targets.includes(id)) continue;
      let damage = threat.amountByTarget?.[id] ?? threat.amount;
      if (capabilities.spellThreats.includes(threat) && form && malice > 0) damage = Math.min(4, damage + 1);
      if (threat.shieldable && player.effects.some(effect => effect.name === 'holyShield')) continue;
      spellLoss = Math.max(spellLoss, Math.max(0, count + damage - player.limit) * threat.readiness);
    }
    exposure += Math.max(attackLoss, spellLoss) / (1 + step * .12);
  }
  return exposure;
}

export function ragingRisk(state, id, malice = 1, count = state.players[id].count) {
  return Math.max(0, formExposure(state, id, { form: true, malice, count }) - formExposure(state, id, { form: false, malice: 0, count }));
}

export function pollutionComparison(state, id, targetId, amount, type, api) {
  const player = state.players[id];
  if (!player.heroState.form || player.heroState.malice <= 0 || state.players[targetId].team === player.team) return { gain: -Infinity };
  const before = api.copy(state), after = api.copy(state);
  api.hurt(before, targetId, amount, type, { sourceId: id });
  after.players[id].heroState.malice--;
  // No-healing damage leaves the target's treatment tokens in place.
  api.applyActualDamage(after, targetId, amount + 1, type);
  if (!api.terminal(after) && state.current === id && after.players[id].heroState.malice === 0) {
    after.players[id].heroState.form = null;
    if (after.players[id].energy.crystal > 0) { after.players[id].energy.crystal--; after.players[id].energy.gem++; }
  }
  const exit = state.current === id && player.heroState.malice === 1 ? ragingRisk(state, id, 1) * 6 : 0;
  return { gain: api.evaluate(after) - api.evaluate(before) + exit, state: after };
}

function outputOpportunity(state, id, api) {
  const player = state.players[id], enemies = state.players.filter(p => p.team !== player.team);
  const modes = [];
  if (attackCount(player)) modes.push({ amount: 2, type: 'attack', weight: .55 });
  if (player.hand.some(card => card.name === 'magicBullet')) modes.push({ amount: 2, type: 'spell', weight: .5 });
  if (player.hand.some(card => card.name === 'poison')) modes.push({ amount: 1, type: 'spell', weight: .3 });
  return Math.max(0, ...modes.flatMap(mode => enemies.map(target => {
    const base = mode.amount + Number(target.healing > 0);
    return mode.weight * (api.damageGain(state, id, target.id, base + 1, mode.type) - api.damageGain(state, id, target.id, base, mode.type));
  })));
}

export function preferredMalice(state, id) {
  const p = state.players[id];
  if (!p.heroState.form) return 0;
  // One point funds a no-healing hit and permits a same-turn exit. Keeping two
  // is an option only when additional damage routes can actually consume it.
  const spells = p.hand.filter(card => ['poison', 'magicBullet'].includes(card.name)).length;
  const pressure = ragingRisk(state, id, 2);
  return spells >= 2 && pressure < .5 ? 2 : 1;
}

export function formPreference(state, id, api) {
  return outputOpportunity(state, id, api) - ragingRisk(state, id, 1) * 8;
}

export function twistedMode(state, id, api, { allowDiscard = true, keepId = null } = {}) {
  const player = state.players[id];
  const candidates = [];
  const draw = api.copy(state); api.draw(draw, id, 2);
  candidates.push({ mode: 'draw', state: draw, score: api.evaluate(draw) });
  if (allowDiscard && player.count > 2) {
    const usable = ownCards(player).filter(card => card.name !== 'holyLight');
    const keep = keepId ?? usable.find(card => card.type === 'attack')?.id ?? usable[0]?.id;
    if (keep) {
      const discard = api.copy(state), cards = discard.players[id].hand;
      // Preserve the planned action; expensive defense and useful spell bursts
      // follow ordinary retention rather than an arbitrary fixed card index.
      const priority = card => (card.name === 'darkStrike' ? 150 : card.name === 'holyLight' ? 130 : card.type === 'attack' ? 70 : card.name === 'magicBullet' || card.name === 'poison' ? 60 : 35);
      const costs = cards.filter(card => !card.reserve && card.id !== keep).sort((a,b) => priority(a) - priority(b)).slice(0,2);
      if (costs.length === 2) { api.spend(discard,id,costs); candidates.push({mode:'discard',state:discard,score:api.evaluate(discard)}); }
    }
  }
  return candidates.sort((a,b) => b.score - a.score)[0];
}

export function prepareTwisted(state, id, form, api, { pay = true, keepId = null } = {}) {
  const next = api.copy(state);
  if (pay) api.payEnergy(next, id, 1, 'gem');
  next.players[id].heroState.form = form;
  const option = twistedMode(next, id, api, { keepId });
  option.state.players[id].heroState.malice = preferredMalice(option.state, id);
  return { ...option, activated: 'twistedLove' };
}
