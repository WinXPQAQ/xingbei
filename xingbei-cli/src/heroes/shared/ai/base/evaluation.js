// Scores are policy weights, not rules. Only the deciding player's cards are inspected.
import { aiFor } from './registry.js';
export const aiHeroId = player => player.hero.skills.length ? player.hero.id : "none";
export const elementsOf = (game, playerId, card) => card.getTraits({ game, playerId }).elements;
export const hasSpecialty = (heroId, card) => (aiFor(heroId).specialties ?? []).some(id => card.hasUniqueSkill(id));
export function strongEnemyBeforeTurn(game, playerId) {
  const player = game.player(playerId);
  const current = game.turn.state?.playerId ?? game.current;
  const start = current === playerId ? (current + 1) % game.players.length : current;
  for (let step = 0; step < game.players.length; step++) {
    const id = (start + step) % game.players.length;
    if (id === playerId) return false;
    const other = game.player(id);
    if (other.team !== player.team && aiFor(aiHeroId(other)).strongAttacker) return true;
  }
  return false;
}
export function cardScore(game, playerId, card, retained = []) {
  const player = game.player(playerId), hero = aiHeroId(player);
  const elements = elementsOf(game, playerId, card);
  const copies = retained.filter(other => other.name === card.name).length;
  if (card.name === "darkStrike") return 160 - copies * 4;
  if (card.name === "holyLight") return copies ? Math.max(35, 80 - copies * 18) : 140;
  const sameElement = retained.some(other => other.type === "attack" && elementsOf(game, playerId, other).some(element => elements.includes(element)));
  const spells = retained.filter(other => other.type === "spell" && other.name !== "holyLight").length;
  const attacks = retained.filter(other => other.type === "attack").length;
  const spellScores = { weakness: 62, holyShield: 56, magicBullet: 54, poison: 52 };
  let score = card.type === "attack" ? (sameElement ? 25 : 72) : (spellScores[card.name] ?? 25) - copies * 9;
  if (hasSpecialty(hero, card)) score = 108 - copies * 10;
  score = aiFor(hero).retention?.({ game, playerId, player, card, retained, elements, copies, sameElement, spells, attacks, spellScores, score }) ?? score;
  return score;
}
export function keepCards(game, playerId, cards, count) {
  const remaining = [...cards], kept = [];
  while (kept.length < count && remaining.length) {
    remaining.sort((a, b) => cardScore(game, playerId, b, kept) - cardScore(game, playerId, a, kept));
    kept.push(remaining.shift());
  }
  // Protect the mixed attack/spell hand of these two heroes, without displacing dark/light.
  if (aiFor(aiHeroId(game.player(playerId))).minimumAttacks) {
    const minimum = Math.min(aiFor(aiHeroId(game.player(playerId))).minimumAttacks, count, cards.filter(card => card.type === "attack").length);
    while (kept.filter(card => card.type === "attack").length < minimum) {
      const replacement = remaining.filter(card => card.type === "attack").sort((a, b) => cardScore(game, playerId, b, kept) - cardScore(game, playerId, a, kept))[0];
      const removable = kept.filter(card => card.type !== "attack" && (card.name !== "holyLight" || kept.filter(other => other.name === "holyLight").length > 1)).sort((a, b) => cardScore(game, playerId, a, kept.filter(c => c !== a)) - cardScore(game, playerId, b, kept.filter(c => c !== b)))[0];
      if (!replacement || !removable) break;
      kept.splice(kept.indexOf(removable), 1, replacement); remaining.splice(remaining.indexOf(replacement), 1, removable);
    }
  }
  return kept;
}
export function chooseAiDiscard(game, playerId, count, valid = null) {
  const hand = game.player(playerId).hand;
  const allowed = valid ?? hand.map((_, index) => index);
  const kept = new Set(keepCards(game, playerId, allowed.map(index => hand[index]), allowed.length - count));
  return allowed.filter(index => !kept.has(hand[index]));
}
export function giftScore(game, donorId, recipientId, card) {
  const recipient = game.player(recipientId);
  if (recipient.hand.length >= recipient.handLimit) return -Infinity;
  return cardScore(game, recipientId, card) - cardScore(game, donorId, card, game.player(donorId).hand.filter(other => other !== card)) * 0.32;
}
export function predictedMoraleLoss(target, amount) {
  const healing = Math.min(target.healing, aiFor(aiHeroId(target)).healingCap ?? amount);
  return Math.max(0, target.hand.length + Math.max(0, amount - healing) - target.handLimit);
}
export function effectRemovalScore(game, playerId, card) {
  const friendly = game.player(card.location.playerId).team === game.player(playerId).team;
  const beneficial = card.attachment.effectId === "holyShield";
  return friendly !== beneficial ? (card.attachment.effectId === "weakness" ? 90 : 70) : -80;
}
