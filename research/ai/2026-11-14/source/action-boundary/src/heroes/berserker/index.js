import { Hero } from "../../hero-base.js";
import { Timing } from "../../timing.js";
function createSkills(hero) {
  return [
    { id: "rage", name: "狂化", ...hero.onOwnAttack([Timing.ATTACK_DECLARED, Timing.ATTACK_HIT]),
      resolve({ game, player, timing, context }) { if (timing === Timing.ATTACK_DECLARED || context.sourceHandCount > 3) { context.amount++; game.logSkill(player.id, "rage", `${timing === Timing.ATTACK_DECLARED ? "攻击基础伤害" : "命中时手牌超过3张，伤害"}+1，对${game.actorLabel(context.targetId)}的伤害变为${context.amount}`); } } },
    { id: "bloodBlade", name: "血影狂刀", ...hero.onOwnAttack([Timing.ATTACK_DECLARED, Timing.ATTACK_HIT]),
      filter: payload => hero.isActiveAttack(payload.context) && hero.hasUniqueSkill(payload.context, "bloodBlade"),
      *resolve({ game, player, timing, context }) {
        if (timing === Timing.ATTACK_DECLARED) context.bloodBlade = yield* game.offerSkill(player.id, "bloodBlade", "血影狂刀");
        else if (context.bloodBlade) { const bonus = context.targetHandCount === 2 ? 2 : context.targetHandCount === 3 ? 1 : 0; context.amount += bonus; game.logSkill(player.id, "bloodBlade", `目标手牌${context.targetHandCount}张，伤害+${bonus}，变为${context.amount}`); }
      } },
    { id: "bloodyRoar", name: "血腥咆哮", ...hero.onOwnAttack([Timing.ATTACK_DECLARED]),
      filter: payload => hero.isActiveAttack(payload.context) && hero.hasUniqueSkill(payload.context, "bloodyRoar") && payload.game.player(payload.context.targetId).healing === 2,
      *resolve({ game, player, context }) { if (yield* game.offerSkill(player.id, "bloodyRoar", "血腥咆哮")) { context.forceHitRequested = true; game.logSkill(player.id, "bloodyRoar", `对${game.actorLabel(context.targetId)}的攻击强制命中（目标有2治疗）`); } } },
    { id: "rend", name: "撕裂", ...hero.onOwnAttack([Timing.ATTACK_HIT]), priority: -1,
      filter: ({ game, player }) => game.canPayEnergy(player.id, "gem"),
      *resolve({ game, player, context }) { if (yield* game.offerSkill(player.id, "rend", "撕裂（消耗1宝石）", context)) { game.payEnergy(player.id, "gem"); context.amount += 2; game.logSkill(player.id, "rend", `对${game.actorLabel(context.targetId)}的攻击伤害+2，变为${context.amount}`); } } },
  ];
}

export class Berserker extends Hero {
  constructor(enabled = true) {
    super({ id: "berserker", name: "狂战士" });
    if (enabled) this.skills = createSkills(this);
  }
}
