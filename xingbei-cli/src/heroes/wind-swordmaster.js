import { Hero } from "../hero-base.js";
import { Timing } from "../timing.js";
function createSkills(hero) {
  return [
    { id: "windFury", name: "风怒追击", ...hero.onOwnTurn([Timing.ATTACK_ACTION_END]),
      filter: payload => hero.isAttackAction(payload.context) && !payload.context.usedSkills.windFury && payload.player.hand.some(card => card.type === "attack" && card.getTraits({ game: payload.game, playerId: payload.player.id }).elements.includes("wind")),
      *resolve({ game, player, context }) { if (yield* game.offerSkill(player.id, "windFury", "风怒追击")) { context.usedSkills.windFury = true; game.turn.addAttackAction({ element: "wind", sourceSkillId: "windFury" }); } } },
    { id: "holySword", name: "圣剑", timings: [Timing.ATTACK_DECLARED, Timing.ATTACK_ACTION_END], bindings: [{ role: "actor", timings: [Timing.ATTACK_DECLARED] }, { role: "player", timings: [Timing.ATTACK_ACTION_END] }],
      filter: payload => payload.timing === Timing.ATTACK_DECLARED ? hero.isActiveAttack(payload.context) && payload.game.turn.state?.attackCount === 3 : hero.isAttackAction(payload.context) && payload.context.holySwordRefresh,
      *resolve({ game, player, context, timing, options }) {
        if (timing === Timing.ATTACK_DECLARED) { context.forceHitRequested = true; game.turn.state.holySwordRefresh = true; game.logSkill(player.id, "holySword", `第3次主动攻击，对${game.actorLabel(context.targetId)}强制命中`); return; }
        context.holySwordRefresh = false;
        const count = yield { type: "numberChoice", skillId: "holySword", playerId: player.id, title: "圣剑：摸X张再弃X张", choices: [0,1,2,3].map(value => ({ value, label: `${value}张` })), defaultValue: 0 };
        if (![0,1,2,3].includes(count)) throw new Error("圣剑数量必须为0至3");
        game.logSkill(player.id, "holySword", count ? `选择摸${count}张再暗弃${count}张` : "选择不换牌");
        if (!count) return;
        yield* game.drawSteps(player.id, count, { overflow: "defer", moraleLoss: false }); yield* game.present();
        const cards = yield* game.chooseHandCards(player.id, count, () => true, { title: "圣剑：弃置手牌" });
        game.discardCards(player.id, cards, { visibility: "hidden", reason: "holySword" });
        yield* game.present();
        if (player.pendingOverflow) yield { type: "overflow", player };
      } },
    { id: "stormArt", name: "烈风技", ...hero.onOwnAttack([Timing.ATTACK_DECLARED]),
      filter: payload => hero.hasUniqueSkill(payload.context, "stormArt") && payload.game.player(payload.context.targetId).getStatus("holyShield").length > 0,
      *resolve({ game, player, context }) { if (yield* game.offerSkill(player.id, "stormArt", "烈风技")) { context.shieldable = false; context.canCounter = false; game.logSkill(player.id, "stormArt", `对${game.actorLabel(context.targetId)}的攻击无视圣盾，且不能应战，仍可使用圣光`); } } },
    { id: "galeArt", name: "疾风技", ...hero.onOwnAttack([Timing.ATTACK_DECLARED]),
      filter: payload => hero.isActiveAttack(payload.context) && hero.hasUniqueSkill(payload.context, "galeArt"),
      *resolve({ game, player, context }) { if (yield* game.offerSkill(player.id, "galeArt", "疾风技", context)) game.turn.addAttackAction({ sourceSkillId: "galeArt" }); } },
    { id: "swordShadow", name: "剑影", ...hero.onOwnTurn([Timing.ATTACK_ACTION_END]),
      filter: payload => hero.isAttackAction(payload.context) && !payload.context.usedSkills.swordShadow && payload.game.canPayEnergy(payload.player.id, "crystal"),
      *resolve({ game, player, context }) { if (yield* game.offerSkill(player.id, "swordShadow", "剑影（消耗1水晶）")) { yield* game.paySkillEnergy(player.id, "crystal"); context.usedSkills.swordShadow = true; game.turn.addAttackAction({ sourceSkillId: "swordShadow" }); } } },
  ];
}

export class WindSwordmaster extends Hero {
  constructor(enabled = true) {
    super({ id: "windSwordmaster", name: "风之剑圣" });
    if (enabled) this.skills = createSkills(this);
  }
}
