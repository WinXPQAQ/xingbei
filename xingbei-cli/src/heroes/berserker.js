import { Timing } from "../timing.js";
const ownsAttack = ({ player, context }) => context.actorId === player.id;
export const berserkerSkills = [
  { id: "rage", name: "狂化", timings: [Timing.ATTACK_DECLARED, Timing.ATTACK_HIT], filter: ownsAttack,
    resolve({ timing, context }) { if (timing === Timing.ATTACK_DECLARED || context.sourceHandCount > 3) context.amount++; } },
  { id: "bloodBlade", name: "血影狂刀", timings: [Timing.ATTACK_DECLARED, Timing.ATTACK_HIT],
    filter: payload => ownsAttack(payload) && !payload.context.isCounter && payload.context.card.hasUniqueSkill("bloodBlade"),
    *resolve({ game, player, timing, context }) {
      if (timing === Timing.ATTACK_DECLARED) context.bloodBlade = yield* game.offerSkill(player.id, "bloodBlade", "血影狂刀");
      else if (context.bloodBlade) context.amount += context.targetHandCount === 2 ? 2 : context.targetHandCount === 3 ? 1 : 0;
    } },
  { id: "bloodyRoar", name: "血腥咆哮", timings: [Timing.ATTACK_DECLARED],
    filter: payload => ownsAttack(payload) && !payload.context.isCounter && payload.context.card.hasUniqueSkill("bloodyRoar") && payload.game.player(payload.context.targetId).healing === 2,
    *resolve({ game, player, context }) { if (yield* game.offerSkill(player.id, "bloodyRoar", "血腥咆哮")) context.forceHitRequested = true; } },
  { id: "rend", name: "撕裂", timings: [Timing.DAMAGE_BEFORE],
    filter: ({ game, player, context }) => context.actorId === player.id && context.damageType === "attack" && context.hit && game.canPayEnergy(player.id, "gem"),
    *resolve({ game, player, context }) { if (yield* game.offerSkill(player.id, "rend", "撕裂（消耗1宝石）")) { game.payEnergy(player.id, "gem"); context.amount += 2; } } },
];
