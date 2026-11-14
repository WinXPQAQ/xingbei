import { aiHeroId, cardScore, elementsOf, giftScore, predictedMoraleLoss, effectRemovalScore } from "./evaluation.js";
import { planWindAttacks } from "./wind-plan.js";

export function attackScore(game, actorId, card, targetId) {
  const actor = game.player(actorId), target = game.player(targetId);
  let damage = aiHeroId(actor) === "berserker" ? 3 + Number(actor.hand.length > 4) : 2;
  if (aiHeroId(actor) === "berserker" && card.hasUniqueSkill("bloodBlade")) damage += target.hand.length === 2 ? 2 : target.hand.length === 3 ? 1 : 0;
  let score = 35 + target.hand.length * 3 + predictedMoraleLoss(target, damage) * 14;
  if (target.getStatus("holyShield").length) score -= 25;
  if (card.name === "darkStrike") score += 8;
  if (aiHeroId(actor) === "marksman") {
    if (actor.hand.some(other => other.type === "spell") || elementsOf(game, actorId, card).includes("thunder") || card.hasUniqueSkill("precisionShot")) score += target.hand.length * 5;
  }
  return score;
}
function combinations(items, count) {
  if (!count) return [[]];
  return items.flatMap((item, index) => combinations(items.slice(index + 1), count - 1).map(rest => [item, ...rest]));
}
function skillValue(game, player, skillId, cards, targets, mode) {
  const target = game.player(targets[0] ?? player.id), friendly = target.team === player.team;
  const loss = amount => predictedMoraleLoss(target, amount);
  if (skillId === "angelWall") return friendly ? 65 + target.hand.length * 3 : -Infinity;
  if (skillId === "angelBlessing") {
    if (targets.some(id => id === player.id || game.player(id).team !== player.team)) return -Infinity;
    const count = targets.reduce((sum, id) => sum + Math.min(game.player(id).hand.length, targets.length === 1 ? 2 : 1), 0);
    return count ? 12 + count * 4 - Math.max(0, player.hand.length - cards.length + count - player.handLimit) * 30 : -Infinity;
  }
  if (["windCleansing", "sealBreaking"].includes(skillId)) return Math.max(...target.getBasicEffects().map(card => effectRemovalScore(game, player.id, card))) - (skillId === "sealBreaking" ? 15 : 0);
  if (skillId.endsWith("Seal")) return 75 + target.hand.length * 3;
  if (skillId === "fivefoldBinding") return 68 + target.hand.length * 3;
  if (skillId === "flashTrap") return friendly ? -Infinity : 38 + loss(2) * 24;
  if (skillId === "snipe") {
    if (friendly || !player.hand.some(card => card.type === "attack")) return -Infinity;
    return 35 + Math.max(0, 5 - target.handLimit) * 30 + Math.max(0, 5 - target.hand.length) * 3;
  }
  if (skillId === "prayer") return Math.min(2, Math.max(0, game.getHealingLimit(player.id) - player.healing)) * 20;
  if (skillId === "waterPower") {
    if (!friendly || target.hand.length >= target.handLimit) return -Infinity;
    const gifts = player.hand.filter(card => !cards.includes(card));
    const gift = gifts.length ? Math.max(...gifts.map(card => giftScore(game, player.id, target.id, card))) * 0.5 : 0;
    return 18 + gift + (player.healing < game.getHealingLimit(player.id) ? 9 : 0) + (target.healing < game.getHealingLimit(target.id) ? 9 : 0);
  }
  if (skillId === "sacredDomain") {
    if (mode === "damage") return friendly ? -Infinity : 30 + loss(2) * 28 + (loss(2) >= game.teams[target.team].morale ? 500 : 0);
    return 12 + Math.min(2, Math.max(0, game.getHealingLimit(player.id) - player.healing)) * 15 + (target.healing < game.getHealingLimit(target.id) ? 12 : 0);
  }
  return 0;
}
export function rankAiActions(game, actorId) {
  const player = game.player(actorId), candidates = [];
  const add = (action, score, reason) => { if (Number.isFinite(score)) candidates.push({ action, score, reason }); };
  if (game.canRefreshUnableHand(actorId)) return [{ action: { type: "refresh" }, score: 1000, reason: "refresh-unusable-hand" }];
  const windPlan = aiHeroId(player) === "windSwordmaster" ? planWindAttacks(game, actorId) : null;
  const legal = game.legalCards(actorId);
  for (const { card, index, targets } of legal) for (const targetId of targets) {
    const target = game.player(targetId), friendly = target.team === player.team;
    let score;
    if (card.type === "attack") {
      score = attackScore(game, actorId, card, targetId);
      if (windPlan?.count >= 3 && windPlan.steps[0] === card.id) score += 130;
      else if (aiHeroId(player) === "windSwordmaster" && !(game.turn.state?.attackCount) && elementsOf(game, actorId, card).includes("wind") && legal.some(entry => entry.card.type === "attack" && !elementsOf(game, actorId, entry.card).includes("wind"))) score -= 90;
    } else if (card.name === "holyShield") score = friendly ? 42 + target.hand.length * 2 : -Infinity;
    else if (["poison", "weakness"].includes(card.name)) score = friendly ? -Infinity : (card.name === "weakness" ? 46 : 32) + target.hand.length * 4;
    else score = 32 + predictedMoraleLoss(target, 2) * 12;
    if (aiHeroId(player) === "sealer" && card.type === "spell" && player.hand.some(other => other.type === "attack")) score += 65;
    add({ type: "play", index, targetId }, score - cardScore(game, actorId, card, player.hand.filter(other => other !== card)) * 0.12, "card-action");
  }
  for (const entry of game.legalSkillActions(actorId)) {
    for (const mode of entry.spec.modes?.map(choice => choice.value) ?? [undefined]) {
      const spec = game.skillActionSpec(actorId, { skillId: entry.skillId, mode });
      const costs = combinations(player.hand.filter(spec.cardFilter ?? (() => true)), spec.cardCount ?? 0);
      const targets = (spec.targetCounts ?? [spec.targetCount ?? 1]).flatMap(count => combinations(spec.targets, count));
      for (const cards of costs) for (const targetIds of targets) {
        let score = skillValue(game, player, entry.skillId, cards, targetIds, mode);
        score -= cards.reduce((sum, card) => sum + cardScore(game, actorId, card, player.hand.filter(other => !cards.includes(other))) * 0.15, 0);
        if (spec.energy) score -= 12;
        if (aiHeroId(player) === "sealer" && spec.type === "spell" && player.hand.some(card => card.type === "attack" && !cards.includes(card))) score += 65;
        add({ type: "skill", skillId: entry.skillId, mode, cardIds: cards.map(card => card.id), targetIds }, score, "hero-action");
      }
    }
  }
  const stones = game.stoneCounts(player.team);
  if (game.canDrawSpecial(actorId)) {
    add({ type: "purchase" }, 18 + (3 - player.hand.length) * 9, "replenish-hand");
    if (stones.total >= 3) {
      const options = game.synthesisOptions(player.team);
      const enemy = player.team === "red" ? "blue" : "red";
      add({ type: "synthesize", gemCount: options.automatic ? options.gemCount : options.choices[0] }, game.teams[enemy].morale <= 1 || game.teams[player.team].cups >= 4 ? 1000 : 85, "score-cup");
    }
  }
  if (game.canRefine(actorId)) {
    const capacity = 3 - player.energy.gem - player.energy.crystal;
    let count = Math.min(2, capacity, stones.total);
    const enemy = player.team === "red" ? "blue" : "red";
    const priestFinish = aiHeroId(player) === "priest" && stones.crystal > 0 && !game.canPayEnergy(actorId, "crystal") && player.healing > 0 && player.hand.length >= 2 && game.teams[enemy].morale <= 2 && game.players.some(target => target.team !== player.team && predictedMoraleLoss(target, 2) >= game.teams[enemy].morale);
    const windSetup = aiHeroId(player) === "windSwordmaster" && player.hand.filter(card => card.type === "attack").length >= 3 && player.hand.some(card => card.hasUniqueSkill("galeArt") || elementsOf(game, actorId, card).includes("wind")) && windPlan.count < 3 && planWindAttacks(game, actorId, { energy: player.energy.gem + player.energy.crystal + 1 }).count >= 3;
    if (count < 2 && !priestFinish && !windSetup) count = 0;
    if (count) {
      const gem = aiHeroId(player) === "berserker" ? Math.min(count, stones.gem) : Math.max(0, count - stones.crystal);
      add({ type: "refine", stones: { gem, crystal: count - gem } }, priestFinish ? 100 : windSetup ? 82 : 42 + Number(player.energy.gem + player.energy.crystal === 0) * 10, "prepare-energy");
    }
  }
  add({ type: "pass" }, 0, "end-turn");
  return candidates.sort((a, b) => b.score - a.score);
}
