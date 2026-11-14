import { createDeck } from '../../cards.js';
import { aiHeroId, elementsOf, predictedMoraleLoss } from '../v1.0/evaluation.js';
import { publicBeliefs } from '../public-history.js';

// Fixed public deck composition, never the live deck or hidden discard contents.
const printedDeck = createDeck();
const lightRate = printedDeck.filter(card => card.name === 'holyLight').length / printedDeck.length;
export function hitEstimate(game, actorId, card, targetId, { counter = false, history = true } = {}) {
  const actor = game.player(actorId), target = game.player(targetId), hero = aiHeroId(actor);
  const elements = elementsOf(game, actorId, card);
  const shield = target.getStatus('holyShield').length > 0;
  const forced = (hero === 'windSwordmaster' && !counter && (game.turn.state?.attackCount ?? 0) === 2)
    || (hero === 'berserker' && !counter && card.hasUniqueSkill('bloodyRoar') && target.healing === 2)
    || (hero === 'marksman' && card.hasUniqueSkill('precisionShot') && (shield || target.hand.length >= 4));
  if (forced) return 1;
  const storm = hero === 'windSwordmaster' && card.hasUniqueSkill('stormArt') && shield;
  if (shield && !storm) return 0;
  const counterable = card.name !== 'darkStrike' && !storm && !(hero === 'marksman' && elements.includes('thunder'));
  const gap = history ? publicBeliefs(game).get(targetId) ?? {} : {};
  const missing = elements.reduce((value, element) => Math.min(value, gap[element] ?? 0), 1);
  const counterRate = counterable ? printedDeck.filter(other => other.type === 'attack' && (other.name === 'darkStrike' || other.elements.some(element => elements.includes(element)))).length / printedDeck.length * (1 - missing) : 0;
  const responseRate = Math.min(0.95, counterRate + lightRate * (1 - (gap.light ?? 0)));
  return (1 - responseRate) ** target.hand.length;
}
export function readingAdjustment(game, actorId, card, targetId, weight = 1, history = true) {
  const probability = hitEstimate(game, actorId, card, targetId, { history });
  const actor = game.player(actorId), target = game.player(targetId);
  const damage = aiHeroId(actor) === 'berserker' ? 3 + Number(actor.hand.length > 4) : 2;
  return weight * (32 + 14 * predictedMoraleLoss(target, damage)) * (probability - 0.5);
}
