import { Hero } from "../hero-base.js";
import { Timing } from "../timing.js";
function createSkills(hero) {
  return [
    { id: "rage", name: "狂化", ...hero.onOwnAttack([Timing.ATTACK_DECLARED, Timing.ATTACK_HIT]),
      resolve({ timing, context }) { if (timing === Timing.ATTACK_DECLARED || context.sourceHandCount > 3) context.amount++; } },
    { id: "bloodBlade", name: "血影狂刀", ...hero.onOwnAttack([Timing.ATTACK_DECLARED, Timing.ATTACK_HIT]),
      filter: payload => hero.isActiveAttack(payload.context) && hero.hasUniqueSkill(payload.context, "bloodBlade"),
      *resolve({ game, player, timing, context }) {
        if (timing === Timing.ATTACK_DECLARED) context.bloodBlade = yield* game.offerSkill(player.id, "bloodBlade", "血影狂刀");
        else if (context.bloodBlade) context.amount += context.targetHandCount === 2 ? 2 : context.targetHandCount === 3 ? 1 : 0;
      } },
    { id: "bloodyRoar", name: "血腥咆哮", ...hero.onOwnAttack([Timing.ATTACK_DECLARED]),
      filter: payload => hero.isActiveAttack(payload.context) && hero.hasUniqueSkill(payload.context, "bloodyRoar") && payload.game.player(payload.context.targetId).healing === 2,
      *resolve({ game, player, context }) { if (yield* game.offerSkill(player.id, "bloodyRoar", "血腥咆哮")) context.forceHitRequested = true; } },
    { id: "rend", name: "撕裂", ...hero.onDamage([Timing.DAMAGE_BEFORE], "actor", ["attack"]),
      filter: ({ game, player, context }) => context.hit && game.canPayEnergy(player.id, "gem"),
      *resolve({ game, player, context }) { if (yield* game.offerSkill(player.id, "rend", "撕裂（消耗1宝石）")) { game.payEnergy(player.id, "gem"); context.amount += 2; } } },
  ];
}

export class Berserker extends Hero {
  constructor(enabled = true) {
    super({ id: "berserker", name: "狂战士" });
    if (enabled) this.skills = createSkills(this);
  }
}
