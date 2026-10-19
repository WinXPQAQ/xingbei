// Scores are policy weights, not rules. Only the deciding player's cards are inspected.
const specialties = {
  berserker: ["bloodBlade", "bloodyRoar"], windSwordmaster: ["galeArt", "stormArt"],
  marksman: ["flashTrap", "precisionShot"], sealer: ["earthSeal", "waterSeal", "fireSeal", "windSeal", "thunderSeal"],
  guardianAngel: ["angelWall"], priest: [],
};
export const aiHeroId = player => player.hero.skills.length ? player.hero.id : "none";
export const elementsOf = (game, playerId, card) => card.getTraits({ game, playerId }).elements;
export const hasSpecialty = (heroId, card) => (specialties[heroId] ?? []).some(id => card.hasUniqueSkill(id));
export function strongEnemyBeforeTurn(game, playerId) {
  const player = game.player(playerId);
  const current = game.turn.state?.playerId ?? game.current;
  const start = current === playerId ? (current + 1) % game.players.length : current;
  for (let step = 0; step < game.players.length; step++) {
    const id = (start + step) % game.players.length;
    if (id === playerId) return false;
    const other = game.player(id);
    if (other.team !== player.team && ["berserker", "windSwordmaster"].includes(aiHeroId(other))) return true;
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
  if (hero === "windSwordmaster") {
    if (card.hasUniqueSkill("galeArt")) score = 120 - copies * 9;
    else if (elements.includes("wind")) score = sameElement ? 55 : 112;
    else if (card.hasUniqueSkill("stormArt")) score = 100 - copies * 10;
  }
  if (["berserker", "windSwordmaster"].includes(hero) && card.type === "spell") score = 10 + (spellScores[card.name] ?? 0) / 10 - copies * 2;
  if (["marksman", "sealer"].includes(hero)) {
    if (card.type === "spell") score = spells >= Math.floor(player.handLimit / 2) ? 12 : (hero === "marksman" ? 84 : 77) + ((spellScores[card.name] ?? 52) - 52) / 2 - spells * 7;
    if (card.type === "attack" && attacks < 2) score += 22;
    if (hero === "marksman" && card.hasUniqueSkill("flashTrap")) score = 115 - copies * 10 + (attacks < 2 ? 22 : 0);
    else if (hero === "marksman" && card.hasUniqueSkill("precisionShot")) score = 90 - copies * 10 + (attacks < 2 ? 22 : 0);
    if (hero === "marksman" && elements.includes("thunder")) score = Math.max(score, sameElement ? 45 : 95);
  }
  if (hero === "guardianAngel" && elements.some(element => ["wind", "water"].includes(element))) score = Math.max(score, sameElement ? 30 : 90);
  if (hero === "priest") {
    if (elements.includes("water")) score = Math.max(score, sameElement ? 65 : 110);
    if (card.type === "spell") score = spells < 2 ? 99 + ((spellScores[card.name] ?? 52) - 52) / 2 : (strongEnemyBeforeTurn(game, playerId) ? 64 : 79) - spells;
    if (card.type === "attack" && !sameElement && strongEnemyBeforeTurn(game, playerId)) score = Math.max(score, 90);
    // Recipient's private hand is deliberately not used for this estimate.
    if (game.players.some(other => other.team === player.team && other.id !== playerId && other.hand.length < other.handLimit && hasSpecialty(aiHeroId(other), card))) score = Math.max(score, 68);
  }
  return score;
}
export function keepCards(game, playerId, cards, count) {
  const remaining = [...cards], kept = [];
  while (kept.length < count && remaining.length) {
    remaining.sort((a, b) => cardScore(game, playerId, b, kept) - cardScore(game, playerId, a, kept));
    kept.push(remaining.shift());
  }
  // Protect the mixed attack/spell hand of these two heroes, without displacing dark/light.
  if (["marksman", "sealer"].includes(aiHeroId(game.player(playerId)))) {
    const minimum = Math.min(2, count, cards.filter(card => card.type === "attack").length);
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
  const healing = Math.min(target.healing, aiHeroId(target) === "priest" ? 1 : amount);
  return Math.max(0, target.hand.length + Math.max(0, amount - healing) - target.handLimit);
}
export function effectRemovalScore(game, playerId, card) {
  const friendly = game.player(card.location.playerId).team === game.player(playerId).team;
  const beneficial = card.attachment.effectId === "holyShield";
  return friendly !== beneficial ? (card.attachment.effectId === "weakness" ? 90 : 70) : -80;
}
