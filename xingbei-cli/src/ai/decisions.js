import { cardScore, chooseAiDiscard, giftScore, predictedMoraleLoss, effectRemovalScore } from "./evaluation.js";
import { planWindAttacks } from "./wind-plan.js";
import { attackScore } from "./actions.js";

export function chooseAiResponse(game, request) {
  const { target, valid } = request;
  if (!valid.length) return null;
  // A shield already handles the hit. Keep response resources unless passing it on is useful.
  const candidates = [];
  for (const entry of valid) {
    const cost = cardScore(game, target.id, entry.card, target.hand.filter(card => card !== entry.card));
    if (entry.card.type === "attack") {
      for (const opponent of request.counterTargets) candidates.push({ value: { index: entry.index, targetId: opponent.id }, score: 35 + attackScore(game, target.id, entry.card, opponent.id) * 0.3 - cost * 0.3 });
    } else candidates.push({ value: { index: entry.index, targetId: request.nextTarget?.id ?? null }, score: (entry.card.name === "magicBullet" ? 45 : 36) - cost * 0.15 });
  }
  if (request.shieldable !== false && target.getStatus("holyShield").length) candidates.push({ value: null, score: 55 });
  return candidates.sort((a, b) => b.score - a.score)[0]?.value ?? null;
}
export function chooseAiRuleDecision(request, game) {
  // Compatibility for external decision consumers without a game context.
  if (!game) return request.defaultValue ?? null;
  const player = game.player(request.playerId ?? request.player?.id);
  const context = request.context ?? {};
  if (request.type === "weakness") return player.hand.length + 3 <= player.handLimit ? "draw" : "skip";
  if (request.type === "bindingChoice") {
    const seals = game.players.flatMap(target => target.statuses).filter(card => game.effects.get(card.attachment.effectId)?.isSeal).length;
    const draw = 2 + Math.min(2, seals) + (player.getStatus("weakness").length ? 3 : 0);
    return player.hand.length + draw <= player.handLimit ? "draw" : "skip";
  }
  if (request.type === "overflow") return game.resolveOverflow(player.id, chooseAiDiscard(game, player.id, player.hand.length - player.handLimit));
  if (request.type === "healing") {
    const needed = Math.max(0, player.hand.length + (context.amount ?? 0) - player.handLimit);
    return request.choices.filter(choice => choice.value <= needed).at(-1)?.value ?? 0;
  }
  if (request.type === "cardChoice") {
    if (request.purpose === "give") {
      const recipient = game.player(request.recipientId);
      return [...request.valid].sort((a, b) => {
        const value = index => recipient.team === player.team ? giftScore(game, player.id, recipient.id, player.hand[index]) : -cardScore(game, player.id, player.hand[index]);
        return value(b) - value(a);
      }).slice(0, request.count);
    }
    if (request.skillId === "piercingShot" && predictedMoraleLoss(game.player(context.targetId), 2) === 0) return null;
    return chooseAiDiscard(game, player.id, request.count, request.valid);
  }
  if (request.type === "playerChoice") {
    const candidates = request.choices.filter(choice => game.player(choice.value).team === player.team);
    return [...(candidates.length ? candidates : request.choices)].sort((a, b) => {
      const value = id => {
        const target = game.player(id), cap = request.skillId === "holyContract" ? 4 : game.getHealingLimit(id);
        return Math.max(0, cap - target.healing) * 10 + target.hand.length;
      };
      return value(b.value) - value(a.value);
    })[0].value;
  }
  if (request.type === "effectChoice") return [...request.choices].sort((a, b) => effectRemovalScore(game, player.id, game.cards.get(b.value)) - effectRemovalScore(game, player.id, game.cards.get(a.value)))[0].value;
  if (request.type === "numberChoice") {
    if (request.skillId === "divineShelter") return request.choices.at(-1).value;
    if (request.skillId === "holySword") return Math.min(3, player.hand.filter(card => cardScore(game, player.id, card, player.hand.filter(other => other !== card)) < 75).length);
    if (request.skillId === "holyContract") return Math.min(player.healing - (request.reservedHealing ?? 0), Math.max(1, 4 - game.player(request.targetId).healing));
  }
  if (request.type === "skillChoice") {
    if (request.skillId === "rend") {
      const target = game.player(context.targetId);
      return predictedMoraleLoss(target, context.amount + 2) > predictedMoraleLoss(target, context.amount);
    }
    if (["galeArt", "windFury", "swordShadow"].includes(request.skillId)) {
      const plan = planWindAttacks(game, player.id, { offer: request.skillId, card: context.card });
      return plan.offers.includes(request.skillId) && (plan.count >= 3 || request.skillId === "windFury");
    }
    if (request.skillId === "holyContract") return player.healing > (request.reservedHealing ?? 0) && request.energy.gem + request.energy.crystal > request.reservedEnergy && game.players.some(target => target.team === player.team && target.id !== player.id && target.healing < 4 && target.hand.length >= target.handLimit - 2);
    if (request.skillId === "angelSong") return game.players.flatMap(target => target.getBasicEffects()).some(card => effectRemovalScore(game, player.id, card) > 0);
    if (request.skillId === "precisionShot") return game.player(context.targetId).getStatus("holyShield").length > 0 || game.player(context.targetId).hand.length >= 4;
    if (request.skillId === "spellExcitation") return player.hand.some(card => card.type === "attack");
    return ["bloodBlade", "bloodyRoar", "stormArt", "revelation"].includes(request.skillId);
  }
  return request.defaultValue ?? null;
}
