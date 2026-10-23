import { RuleError } from "../errors.js";
import { cardName } from "../card-labels.js";
import { Timing } from "../timing.js";

export function* magicSteps(game, actorId, handIndex, options = {}) {
  if (game.winner) throw new RuleError("游戏已经结束");
  const actor = game.player(actorId), card = actor.hand[handIndex];
  if (card?.name !== "magicBullet") throw new RuleError("请选择魔弹");
  if (options.targetId != null && !game.magicTargets(actorId).includes(options.targetId)) throw new RuleError("魔弹目标不合法");
  game.playCard(actor, handIndex, options);
  yield* game.present();
  game.log.push(`${actor.name}使用${cardName(card)}`);
  const direction = options.targetId != null && options.targetId !== game.nearestOpponent(actorId)?.id ? -1 : 1;
  yield* magicRelaySteps(game, actorId, { ...options, direction });
}

export function* magicRelaySteps(game, actorId, options = {}) {
  const participants = new Set([actorId]);
  let sourceId = actorId, damage = 2;
  while (true) {
    if (participants.size === game.players.length) {
      participants.clear(); game.log.push("所有玩家均已被魔弹指定，刷新魔弹指定记录");
    }
    const target = game.magicTarget(sourceId, participants, options.direction ?? 1);
    if (!target) return;
    participants.add(target.id);
    game.recordPublicAction({type:'magic',actorId:sourceId,targetId:target.id,card:'magicBullet',amount:damage});
    game.recordPresentation("relay", { sourceId, playerId: target.id, amount: damage });
    yield* game.flushRuleEvents(options);
    yield* game.present();
    const valid = target.hand.map((card, index) => ({ card, index })).filter(item => game.allowsCard(target.id, item.card, "response") && (item.card.name === "holyLight" || game.canRelayMagic(target.id, item.card)));
    const decision = yield { type: "response", actor: game.player(sourceId), target, valid, damage,
      nextTarget: game.magicTarget(target.id, participants, options.direction ?? 1), participants: [...participants] };
    const picked = decision && valid.find(item => item.index === decision.index);
    if (decision && !picked) throw new RuleError("选择的牌不能响应魔弹");
    if(picked)game.recordPublicAction({type:'response',actorId:target.id,sourceId,card:picked.card.name,result:picked.card.name==='holyLight'?'cancel':'relay'});
    if (picked?.card.name === "holyLight") {
      game.playCard(target, picked.index, options);
      yield* game.flushRuleEvents(options);
    yield* game.present();
      game.recordPresentation("miss", { playerId: target.id, cause: "holyLight" });
      yield* game.flushRuleEvents(options);
    yield* game.present();
      game.log.push(`${target.name}用【圣光】抵消【魔弹】`); return;
    }
    if (picked && game.canRelayMagic(target.id, picked.card)) {
      const next = game.magicTarget(target.id, participants, options.direction ?? 1);
      if (decision.targetId != null && decision.targetId !== next?.id) throw new RuleError("魔弹传递目标不合法");
      if (picked.card.name !== "magicBullet") game.logSkill(target.id, "magicFusion", `将${cardName(picked.card)}视为魔弹传递`);
      game.playCard(target, picked.index, options);
      yield* game.present(); damage++; sourceId = target.id;
      game.log.push(`${target.name}用【魔弹】传递【魔弹】，伤害增至${damage}`); continue;
    }
    const context = { actorId: sourceId, targetId: target.id, hit: true, shieldable: true, damage };
    yield* game.trigger(Timing.MAGIC_HIT_CHECK, context, options);
    if (!context.hit) { game.recordPresentation("miss", { playerId: target.id, cause: context.cause }); yield* game.present(); }
    game.recordPublicAction({type:'magicResult',actorId:sourceId,targetId:target.id,result:context.hit?'hit':context.cause??'blocked',amount:context.hit?context.damage:0});
    if (context.hit) yield* game.damageSteps(target.id, context.damage, { ...options, sourceId, damageType: "spell" });
    if (target.pendingOverflow) yield { type: "overflow", player: target };
    return;
  }
}
