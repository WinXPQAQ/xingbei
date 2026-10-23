import { Hero } from "../hero-base.js";
import { Timing } from "../timing.js";
function createSkills(hero) {
  return [
    { id: "lightningArrow", name: "闪电箭", ...hero.onOwnAttack([Timing.ATTACK_DECLARED]),
      filter: payload => payload.context.attackTraits.elements.includes("thunder"),
      resolve({ game, player, context }) { context.canCounter = false; game.logSkill(player.id, "lightningArrow", `对${game.actorLabel(context.targetId)}的雷系攻击不能应战，仍可使用圣光`); } },
    { id: "piercingShot", name: "贯穿射击", ...hero.onOwnAttack([Timing.ATTACK_MISS]),
      filter: payload => hero.isActiveAttack(payload.context) && payload.player.hand.some(card => card.type === "spell"),
      *resolve({ game, player, context, options }) {
        const cards = yield* game.chooseHandCards(player.id, 1, card => card.type === "spell", { title: "贯穿射击：展示弃1张法术牌", optional: true, skillId: "piercingShot", context: { targetId: context.targetId } });
        if (!cards) return;
        game.logSkill(player.id, "piercingShot", `原攻击未命中，对${game.actorLabel(context.targetId)}造成2点法术伤害`);
        game.discardCards(player.id, cards, { reason: "piercingShot" });
        yield* game.damageSteps(context.targetId, 2, { ...options, sourceId: player.id, damageType: "spell" });
      } },
    { id: "flashTrap", name: "闪光陷阱", action(game, player) {
        return { type: "spell", cardCount: 1, cardFilter: card => card.hasUniqueSkill("flashTrap"), targets: game.players.map(target => target.id) };
      },
      *resolveAction({ game, player, cards, targetIds, options }) {
        game.logSkill(player.id, "flashTrap", `对${game.actorLabel(targetIds[0])}造成2点法术伤害`);
        game.playCard(player, player.hand.indexOf(cards[0]), options);
        yield* game.damageSteps(targetIds[0], 2, { ...options, sourceId: player.id, damageType: "spell" });
      } },
    { id: "precisionShot", name: "精准射击", ...hero.onOwnAttack([Timing.ATTACK_DECLARED]),
      filter: payload => hero.hasUniqueSkill(payload.context, "precisionShot"),
      *resolve({ game, player, context }) { if (yield* game.offerSkill(player.id, "precisionShot", "精准射击（强制命中，伤害-1）", context)) { context.forceHitRequested = true; context.amount--; game.logSkill(player.id, "precisionShot", `对${game.actorLabel(context.targetId)}强制命中，伤害-1，变为${context.amount}`); } } },
    { id: "snipe", name: "狙击", action(game) { return { type: "spell", energy: "crystal", targets: game.players.map(target => target.id) }; },
      *resolveAction({ game, player, targetIds, options }) {
        yield* game.paySkillEnergy(player.id, "crystal");
        const target = game.player(targetIds[0]);
        game.logSkill(player.id, "snipe", `令${game.actorLabel(target.id)}补牌：原有${target.hand.length}张，非伤害摸${Math.max(0, 5 - target.hand.length)}张（补至至少5张；手牌上限${target.handLimit}）`);
        yield* game.drawSteps(target.id, Math.max(0, 5 - target.hand.length), { overflow: options.overflow, cause: { type: "directDraw", sourceId: player.id, skillId: "snipe" } });
        yield* game.present();
        if (target.pendingOverflow) yield { type: "overflow", player: target };
        game.turn.addAttackAction({ sourceSkillId: "snipe" });
      } },
  ];
}

export class Marksman extends Hero {
  constructor(enabled = true) {
    super({ id: "marksman", name: "神箭手" });
    if (enabled) this.skills = createSkills(this);
  }
}
