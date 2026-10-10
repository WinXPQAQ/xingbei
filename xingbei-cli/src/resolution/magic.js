import { RuleError } from "../errors.js";
import { cardName } from "../card-labels.js";
import { Timing } from "../timing.js";

export function* magicSteps(game, actorId, handIndex, options = {}) {
  if (game.winner) throw new RuleError("游戏已经结束");
  const actor = game.player(actorId), card = actor.hand[handIndex];
  if (card?.name !== "magicBullet") throw new RuleError("请选择魔弹");
  game.discardCard(actor, handIndex);
  game.log.push(`${actor.name}使用${cardName(card)}`);
  yield* magicRelaySteps(game, actorId, options);
}

export function* magicRelaySteps(game, actorId, options = {}) {
  const participants = new Set([actorId]);
  let sourceId = actorId, damage = 2;
  while (true) {
    if (participants.size === game.players.length) {
      participants.clear(); game.log.push("所有玩家均已被魔弹指定，刷新魔弹指定记录");
    }
    const target = game.magicTarget(sourceId, participants);
    if (!target) return;
    participants.add(target.id);
    const valid = target.hand.map((card, index) => ({ card, index })).filter(item => ["magicBullet", "holyLight"].includes(item.card.name));
    const decision = valid.length ? yield { type: "response", actor: game.player(sourceId), target, valid, damage,
      nextTarget: game.magicTarget(target.id, participants), participants: [...participants] } : null;
    const picked = decision && valid.find(item => item.index === decision.index);
    if (decision && !picked) throw new RuleError("选择的牌不能响应魔弹");
    if (picked?.card.name === "holyLight") {
      game.discardCard(target, picked.index);
      game.log.push(`${target.name}用【圣光】抵消【魔弹】`); return;
    }
    if (picked?.card.name === "magicBullet") {
      game.discardCard(target, picked.index); damage++; sourceId = target.id;
      game.log.push(`${target.name}用【魔弹】传递【魔弹】，伤害增至${damage}`); continue;
    }
    const context = { actorId: sourceId, targetId: target.id, hit: true, shieldable: true, damage };
    yield* game.trigger(Timing.MAGIC_HIT_CHECK, context, options);
    if (context.hit) yield* game.damageSteps(target.id, context.damage, { ...options, sourceId, magic: true });
    if (target.pendingOverflow) yield { type: "overflow", player: target };
    return;
  }
}
