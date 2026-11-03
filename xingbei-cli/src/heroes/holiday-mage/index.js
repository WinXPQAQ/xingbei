import { MagicalGirl } from "../magical-girl/index.js";
import { Timing } from "../../timing.js";
import { discardCost, choice } from "../shared/actions.js";
export class HolidayMage extends MagicalGirl {
  constructor(enabled = true) {
    super(enabled);
    this.id = "holidayMage";
    this.name = "节日魔导";
    this.portrait = this.id;
    if (!enabled) return;
    this.skills = this.skills.map((skill) =>
      skill.id !== "magicBurst"
        ? skill
        : {
            ...skill,
            action(game, player) {
              return { ...skill.action(game, player), targetCount: 1 };
            },
            *resolveAction({ game, player, cards, targetIds, options }) {
              yield* discardCost(game, player, cards, "magicBurst", options);
              const added = game.addStones(player.team, "gem");
              game.logSkill(player.id, "magicBurst", `战绩区获得${added}宝石`);
              const id = targetIds[0];
              const payment = yield* game.chooseHandCards(
                id,
                1,
                (c) => c.type === "spell",
                {
                  skillId: "holidayBurstResponse",
                  title: "魔爆冲击：可明弃1张法术牌，否则承受2点法术伤害",
                  optional: true,
                },
              );
              if (payment)
                yield* discardCost(
                  game,
                  game.player(id),
                  payment,
                  "magicBurst",
                  options,
                );
              else
                yield* game.damageSteps(id, 2, {
                  ...options,
                  sourceId: player.id,
                  damageType: "spell",
                  skillId: "magicBurst",
                });
            },
          },
    );
    this.addSkills({
      id: "manaShield",
      name: "法力护盾",
      ...this.onDamage([Timing.DAMAGE_BEFORE], "target"),
      filter: ({ player }) => player.hand.some((c) => c.type === "spell"),
      *resolve({ game, player, context, options }) {
        const n = yield* choice(
          player.id,
          "manaShield",
          "法力护盾：可明弃任意数量法术牌",
          Array.from(
            {
              length: player.hand.filter((c) => c.type === "spell").length + 1,
            },
            (_, value) => ({
              value,
              label: value ? `明弃${value}张` : "不发动",
            }),
          ),
          0,
          { amount: context.amount },
        );
        if (n) {
          const cards = yield* game.chooseHandCards(
            player.id,
            n,
            (c) => c.type === "spell",
            { skillId: "manaShieldCards" },
          );
          yield* discardCost(game, player, cards, "manaShield", options);
        }
      },
    });
  }
}
