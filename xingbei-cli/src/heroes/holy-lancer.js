import { Hero } from "../hero-base.js";
import { Timing } from "../timing.js";
import { targets, hasElement, discardCost, choice } from "./actions.js";
export class HolyLancer extends Hero {
  constructor(enabled = true) {
    super({ id: "holyLancer", name: "圣枪骑士" });
    if (!enabled) return;
    this.skills = [
      {
        id: "holyFaith",
        name: "神圣信仰",
        modifyHealingLimit(limit, { game, playerId }) {
          const p = game.player(playerId);
          return (
            limit +
            Number(
              game.teams[p.team].cups >=
                game.teams[p.team === "red" ? "blue" : "red"].cups,
            )
          );
        },
      },
      {
        id: "radiance",
        name: "辉耀",
        action(game, player) {
          return {
            type: "spell",
            cardCount: 1,
            cardFilter: (c) => hasElement(game, player, c, "water"),
            targets: [],
            targetCount: 0,
          };
        },
        *resolveAction({ game, player, cards, options }) {
          yield* discardCost(game, player, cards, "radiance", options);
          for (const p of game.players) game.changeHealing(p.id, 1);
          game.turn.addAttackAction({ sourceSkillId: "radiance" });
        },
      },
      {
        id: "chastisement",
        name: "惩戒",
        action(game, player) {
          return {
            type: "spell",
            cardCount: 1,
            cardFilter: (c) => c.type === "spell",
            targets: game.players
              .filter((p) => p.id !== player.id && p.healing > 0)
              .map((p) => p.id),
          };
        },
        *resolveAction({ game, player, cards, targetIds, options }) {
          yield* discardCost(game, player, cards, "chastisement", options);
          if (game.player(targetIds[0]).healing > 0) {
            game.changeHealing(targetIds[0], -1);
            game.changeHealing(player.id, 1);
          }
          game.turn.addAttackAction({ sourceSkillId: "chastisement" });
        },
      },
      {
        id: "heavenSpear",
        name: "天枪",
        ...this.onOwnAttack([Timing.ATTACK_DECLARED]),
        filter: ({ player, context, game }) =>
          this.isActiveAttack(context) &&
          player.healing >= 2 &&
          !game.turn.state?.usedSkills.blockHeavenSpear,
        *resolve({ game, player, context }) {
          if (!(yield* game.offerSkill(player.id, "heavenSpear", "天枪")))
            return;
          game.changeHealing(player.id, -2);
          context.canCounter = false;
          context.disableHolyStrike = true;
        },
      },
      {
        id: "earthSpear",
        name: "地枪",
        priority: 1,
        ...this.onOwnAttack([Timing.ATTACK_HIT]),
        filter: ({ player, context }) =>
          this.isActiveAttack(context) && player.healing > 0,
        *resolve({ game, player, context }) {
          const n = yield* choice(
            player.id,
            "earthSpear",
            "地枪：移除治疗增加伤害",
            Array.from(
              { length: Math.min(4, player.healing) + 1 },
              (_, value) => ({
                value,
                label: value ? `移除${value}治疗` : "不发动",
              }),
            ),
            0,
          );
          if (n) {
            game.changeHealing(player.id, -n);
            context.amount += n;
            context.disableHolyStrike = true;
            game.logSkill(
              player.id,
              "earthSpear",
              `消耗${n}治疗，攻击伤害+${n}`,
            );
          }
        },
      },
      {
        id: "holyStrike",
        name: "圣击",
        ...this.onOwnAttack([Timing.ATTACK_HIT]),
        filter: ({ context }) => !context.disableHolyStrike,
        *resolve({ game, player }) {
          if (yield* game.offerSkill(player.id, "holyStrike", "圣击"))
            game.changeHealing(player.id, 1);
        },
      },
      {
        id: "holyPrayer",
        name: "圣光祈雨",
        action() {
          return { type: "spell", energy: "gem", targets: [], targetCount: 0 };
        },
        *resolveAction({ game, player }) {
          yield* game.paySkillEnergy(player.id, "gem");
          game.changeHealing(player.id, 2, { limit: 5 });
          if (game.turn.state)
            game.turn.state.usedSkills.blockHeavenSpear = true;
          game.turn.addAttackAction({ sourceSkillId: "holyPrayer" });
        },
      },
    ];
  }
}
