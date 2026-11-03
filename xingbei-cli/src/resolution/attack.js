import { playableCards } from "../playable-cards.js";
import { RuleError } from "../errors.js";
import { cardName } from "../card-labels.js";
import { Timing } from "../timing.js";

export function* attackSteps(game, actorId, handIndex, targetId, options = {}) {
  if (game.winner) throw new RuleError("游戏已经结束");
  let actor = game.player(actorId), target = game.player(targetId);
  let attack = options.virtualAttack ?? playableCards(actor)[handIndex], isCounter = false;
  if (attack?.type !== "attack" || !game.canAttackTarget(actorId, targetId)) throw new RuleError("攻击牌只能指定对手");
  let attackTraits = attack.getTraits({ game, playerId: actor.id, purpose: "attack" });
  if (!options.virtualAttack) game.playCard(actor, handIndex, { ...options, targetId });
  yield* game.present();
  let chainDepth = 0, previousAttackTraits = null, requiresCounterSkill = false;
  while (true) {
    const context = { actorId: actor.id, sourceId: actor.id, targetId: target.id, card: attack, attackTraits,
      isCounter, previousAttackTraits, requiresCounterSkill, chainOriginId: actorId, chainDepth, amount: 2, actionSourceSkillId: isCounter ? null : (options.actionSourceSkillId ?? game.turn.state?.actionSourceSkillId), damageType: "attack", hit: true, shieldable: true, canCounter: true, canHolyLight: true, point: 1 };
    game.log.push(`${actor.name}使用${isCounter ? "应战攻击" : "主动攻击"}${cardName(attack)}，目标是${target.name}`);
    game.recordPublicAction({type:'attack',actorId:actor.id,targetId:target.id,card:attack.name,elements:[...attackTraits.elements],counter:isCounter});
    yield* game.trigger(Timing.ATTACK_DECLARED, context, options);
    // Point 1: attack properties are attached before a teammate may take the response.
    // This window closes before the original target is asked; it is never reopened.
    if (!context.forceHitRequested && !context.forcedHit) yield* game.trigger(Timing.ATTACK_RESPONSE_BEFORE, context, options);
    target = game.player(context.targetId);
    context.point = 2;
    yield* game.trigger(Timing.ATTACK_DECISION, context, options);
    if (context.forceHitRequested) { context.forcedHit = true; context.shieldable = false; }
    const counterTargets = game.players.filter(player => game.canAttackTarget(target.id, player.id, true) && player.id !== actor.id);
    const valid = playableCards(target).map((card, index) => ({ card, index, ...(target.hero.responseAttack?.(game, target, card) ? { asAttack: true } : {}) })).filter(item =>
      game.canRespond(attack, item.card, { actorId: actor.id, targetId: target.id, attackTraits }) &&
      (item.card.name === "holyLight" ? context.canHolyLight : context.canCounter && counterTargets.length));
    const decision = context.forcedHit ? null : context.boundResponse ?? (yield { type: "response", actor, target, attack, attackTraits, valid, counterTargets, isCounter, chainOriginId: actorId, chainDepth, damage: context.amount, shieldable: context.shieldable,
      canCounter: context.canCounter, canHolyLight: context.canHolyLight });
    context.sourceHandCount = actor.hand.length; context.targetHandCount = target.hand.length;
    if (!decision) {
      yield* game.trigger(Timing.ATTACK_HIT_CHECK, context, options);
      if (context.forcedHit) context.hit = true;
      game.recordPublicAction({type:'attackResult',actorId:actor.id,targetId:target.id,card:attack.name,result:context.hit?'hit':context.cause??'blocked'});
      if (context.hit) {
        game.log.push(`${actor.name}的${cardName(attack)}命中${target.name}`);
        // Hit rewards precede hit skills and damage (timing workbook C149).
        // This also preserves the reward when a hit skill ends the game.
        const added = game.addStones(actor.team, isCounter ? "crystal" : "gem");
        game.log.push(`${isCounter ? "应战攻击" : "主动攻击"}命中，${actor.name}一方战绩区${added ? `获得1个${isCounter ? "水晶" : "宝石"}` : "已满5个星石，未增加星石"}`);
        yield* game.trigger(Timing.ATTACK_HIT, context, options);
        if (!context.damageReplaced) yield* game.damageSteps(target.id, context.amount, { ...options, sourceId: actor.id, damageType: "attack", attackContext: context });
      } else {
        game.recordPresentation("miss", { playerId: target.id, cause: context.cause });
        yield* game.trigger(Timing.ATTACK_MISS, context, options);
      }
      yield* game.trigger(Timing.ATTACK_RESOLVED, context, options);
      if (target.pendingOverflow) yield { type: "overflow", player: target };
      break;
    }
    const picked = valid.find(item => item.index === decision.index);
    if (!picked) throw new RuleError("选择的牌不能应战此次攻击");
    let nextTarget;
    const responseAttack = target.hero.responseAttack?.(game, target, picked.card);
    if (picked.card.type === "attack" || responseAttack) {
      const nextId = decision.targetId ?? (yield { type: "target", actor: target, previousActor: actor, attack: picked.card, targets: counterTargets });
      nextTarget = counterTargets.find(player => player.id === nextId);
      if (!nextTarget) throw new RuleError("应战攻击目标不合法");
    }
    requiresCounterSkill = !attack.canRespond(picked.card, { game, actorId: actor.id, targetId: target.id, attackTraits });
    previousAttackTraits = attackTraits;
    const nextTraits = (responseAttack ?? picked.card).getTraits({ game, playerId: target.id, purpose: "attack" });
    const response = game.playCard(target, picked.index, { ...options, targetId: nextTarget?.id ?? actor.id });
    yield* game.present();
    context.hit = false; context.cause = response.name;
    game.recordPublicAction({type:'response',actorId:target.id,sourceId:actor.id,targetId:nextTarget?.id??actor.id,card:response.name,elements:[...nextTraits.elements],result:response.name==='holyLight'?'cancel':'redirect'});
    game.log.push(`${target.name}使用${response.name === "holyLight" ? cardName(response) + "抵消攻击" : "应战攻击" + cardName(response)}，原攻击未命中`);
    yield* game.trigger(Timing.ATTACK_MISS, context, options);
    yield* game.trigger(Timing.ATTACK_RESOLVED, context, options);
    if (response.name === "holyLight") {
      game.recordPresentation("miss", { playerId: target.id, cause: "holyLight" });
      yield* game.present(); break;
    }
    actor = target; target = nextTarget; attack = responseAttack ?? response; attackTraits = nextTraits; isCounter = true; chainDepth++;
  }
}
