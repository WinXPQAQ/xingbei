import { Hero } from "../hero-base.js";
import { Timing } from "../timing.js";
function createSkills(hero) {
  return [
    { id: "lightningArrow", name: "闪电箭", ...hero.onOwnAttack([Timing.ATTACK_DECLARED]),
      filter: payload => payload.context.attackTraits.elements.includes("thunder"),
      resolve({ context }) { context.canCounter = false; } },
    { id: "piercingShot", name: "贯穿射击", ...hero.onOwnAttack([Timing.ATTACK_MISS]),
      filter: payload => hero.isActiveAttack(payload.context) && payload.player.hand.some(card => card.type === "spell"),
      *resolve({ game, player, context, options }) {
        const cards = yield* game.chooseHandCards(player.id, 1, card => card.type === "spell", { title: "贯穿射击：展示弃1张法术牌", optional: true });
        if (!cards) return;
        game.discardCards(player.id, cards, { reason: "piercingShot" });
        yield* game.damageSteps(context.targetId, 2, { ...options, sourceId: player.id, damageType: "spell" });
      } },
    { id: "flashTrap", name: "闪光陷阱", action(game, player) {
        return { type: "spell", cardCount: 1, cardFilter: card => card.hasUniqueSkill("flashTrap"), targets: game.players.map(target => target.id) };
      },
      *resolveAction({ game, player, cards, targetIds, options }) {
        game.playCard(player, player.hand.indexOf(cards[0]), options);
        yield* game.damageSteps(targetIds[0], 2, { ...options, sourceId: player.id, damageType: "spell" });
      } },
    { id: "precisionShot", name: "精准射击", ...hero.onOwnAttack([Timing.ATTACK_DECLARED]),
      filter: payload => hero.hasUniqueSkill(payload.context, "precisionShot"),
      *resolve({ game, player, context }) { if (yield* game.offerSkill(player.id, "precisionShot", "精准射击（强制命中，伤害-1）")) { context.forceHitRequested = true; context.amount--; } } },
    { id: "snipe", name: "狙击", action(game) { return { type: "spell", energy: "crystal", targets: game.players.map(target => target.id) }; },
      *resolveAction({ game, player, targetIds, options }) {
        yield* game.paySkillEnergy(player.id, "crystal");
        const target = game.player(targetIds[0]);
        game.draw(target.id, Math.max(0, 5 - target.hand.length), { overflow: options.overflow, cause: { type: "directDraw", sourceId: player.id, skillId: "snipe" } });
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
