import { Berserker } from "../berserker/index.js";
import { Timing } from "../../timing.js";
import { choice } from "../shared/actions.js";
import { cardName } from "../../card-labels.js";
export class DelinquentGirl extends Berserker {
  constructor(enabled = true) {
    super(enabled);
    this.id = "delinquentGirl";
    this.name = "萝莉番长";
    this.portrait = this.id;
    if (!enabled) return;
    this.skills = this.skills.filter((s) => s.id === "bloodBlade");
    this.addSkills(
      {
        id: "brawlSupreme",
        name: "喧哗上等",
        ...this.onOwnAttack([Timing.ATTACK_HIT]),
        priority: 10,
        resolve({ game, player, context }) {
          let count = 0;
          while (count < 3) {
            const card = game.takeDeckCard();
            if (!card) break;
            const traits = card.getTraits({ game, playerId: player.id });
            game.moveCard(card.id, { zone: "outside" }, { removal: true });
            game.logSkill(
              player.id,
              "brawlSupreme",
              `展示并移除${cardName(card)}`,
            );
            count++;
            if (!traits.fates.includes("X") && card.type !== "spell") break;
          }
          context.amount += count;
          game.logSkill(
            player.id,
            "brawlSupreme",
            `攻击伤害+${count}，变为${context.amount}`,
          );
        },
      },
      {
        id: "bloodyRoar",
        name: "血腥咆哮·爱死天流",
        ...this.onOwnAttack([Timing.ATTACK_DECLARED]),
        filter: ({ game, context }) =>
          this.isActiveAttack(context) &&
          this.hasUniqueSkill(context, "bloodyRoar") &&
          game.player(context.targetId).healing > 0,
        *resolve({ game, player, context }) {
          if (
            yield* game.offerSkill(
              player.id,
              "delinquentRoar",
              "血腥咆哮：禁止暗灭应战及圣光抵挡",
            )
          ) {
            context.canDarkStrike = false;
            context.canHolyLight = false;
            game.logSkill(
              player.id,
              "bloodyRoar",
              "本次攻击不能使用暗灭或圣光，普通同系牌仍可应战",
            );
          }
        },
      },
      {
        id: "recklessBrawl",
        name: "灭茶苦茶",
        ...this.onOwnAttack([Timing.ATTACK_HIT]),
        priority: -1,
        filter: ({ game, player }) => game.canPayEnergy(player.id, "crystal"),
        *resolve({ game, player, context }) {
          const choices = [{ value: null, label: "不发动" }];
          if (game.canPayEnergy(player.id, "gem"))
            choices.push({ value: "gem", label: "1宝石：伤害+2" });
          if (player.energy.crystal > 0)
            choices.push({ value: "crystal", label: "1水晶：伤害+1" });
          const cost = yield* choice(
            player.id,
            "recklessBrawl",
            "灭茶苦茶",
            choices,
            null,
            context,
          );
          if (cost) {
            yield* game.paySkillEnergy(player.id, cost);
            context.amount += cost === "gem" ? 2 : 1;
            game.logSkill(
              player.id,
              "recklessBrawl",
              `攻击伤害变为${context.amount}`,
            );
          }
        },
      },
    );
  }
}
