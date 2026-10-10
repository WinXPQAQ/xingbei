import { RuleError } from "../errors.js";
import { cardName } from "../card-labels.js";
import { Timing } from "../timing.js";

export function* attackSteps(game, actorId, handIndex, targetId, options = {}) {
  if (game.winner) throw new RuleError("游戏已经结束");
  let actor = game.player(actorId), target = game.player(targetId);
  let attack = actor.hand[handIndex], isCounter = false;
  if (attack?.type !== "attack" || actor.team === target.team) throw new RuleError("攻击牌只能指定对手");
  let attackTraits = attack.getTraits({ game, playerId: actor.id, purpose: "attack" });
  game.discardCard(actor, handIndex);
  game.log.push(`${actor.name}使用主动攻击${cardName(attack)}，目标是${target.name}`);
  while (true) {
    const counterTargets = game.players.filter(player => player.team !== target.team && player.id !== actor.id);
    const valid = target.hand.map((card, index) => ({ card, index })).filter(item =>
      game.canRespond(attack, item.card, { actorId: actor.id, targetId: target.id, attackTraits }) && (item.card.name === "holyLight" || counterTargets.length));
    const decision = valid.length ? yield { type: "response", actor, target, attack, attackTraits, valid, counterTargets, isCounter } : null;
    if (!decision) {
      const context = { actorId: actor.id, targetId: target.id, card: attack, isCounter, hit: true, shieldable: true };
      yield* game.trigger(Timing.ATTACK_HIT_CHECK, context, options);
      if (context.hit) {
        game.log.push(`${actor.name}的${cardName(attack)}命中${target.name}`);
        yield* game.damageSteps(target.id, 2, { ...options, sourceId: actor.id });
        const added = game.addStones(actor.team, isCounter ? "crystal" : "gem");
        game.log.push(`${isCounter ? "应战攻击" : "主动攻击"}命中，${actor.name}一方战绩区${added ? `获得1个${isCounter ? "水晶" : "宝石"}` : "已满5个星石，未增加星石"}`);
        yield* game.trigger(Timing.ATTACK_HIT, context, options);
      } else yield* game.trigger(Timing.ATTACK_MISS, context, options);
      if (target.pendingOverflow) yield { type: "overflow", player: target };
      break;
    }
    const picked = valid.find(item => item.index === decision.index);
    if (!picked) throw new RuleError("选择的牌不能应战此次攻击");
    let nextTarget;
    if (picked.card.type === "attack") {
      const nextId = decision.targetId ?? (yield { type: "target", actor: target, previousActor: actor, attack: picked.card, targets: counterTargets });
      nextTarget = counterTargets.find(player => player.id === nextId);
      if (!nextTarget) throw new RuleError("应战攻击目标不合法");
    }
    const nextTraits = picked.card.getTraits({ game, playerId: target.id, purpose: "attack" });
    const response = game.discardCard(target, picked.index);
    game.log.push(`${target.name}使用${response.name === "holyLight" ? cardName(response) + "抵消攻击" : "应战攻击" + cardName(response)}，原攻击未命中`);
    yield* game.trigger(Timing.ATTACK_MISS, { actorId: actor.id, targetId: target.id, card: attack, isCounter, hit: false, cause: response.name }, options);
    if (response.name === "holyLight") break;
    game.log.push(`${target.name}的应战攻击目标是${nextTarget.name}`);
    actor = target; target = nextTarget; attack = response; attackTraits = nextTraits; isCounter = true;
  }
}
