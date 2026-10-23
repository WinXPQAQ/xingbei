import { Hero } from "../hero-base.js";
import { Timing } from "../timing.js";
import {
  choice,
  drawCards,
  discardCost,
  healTarget,
  spendStones,
} from "./actions.js";
export class Valkyrie extends Hero {
  constructor(enabled = true) {
    super({ id: "valkyrie", name: "女武神" });
    if (!enabled) return;
    this.skills = [
      {
        id: "divinePursuit",
        name: "神圣追击",
        ...this.onOwnTurn([Timing.ATTACK_ACTION_END, Timing.SPELL_ACTION_END]),
        filter: ({ player }) => player.healing > 0,
        *resolve({ game, player }) {
          if (!(yield* game.offerSkill(player.id, "divinePursuit", "神圣追击")))
            return;
          game.changeHealing(player.id, -1);
          game.turn.addAttackAction({ sourceSkillId: "divinePursuit" });
        },
      },
      {
        id: "orderSigil",
        name: "秩序之印",
        action() {
          return { type: "spell", targets: [], targetCount: 0 };
        },
        *resolveAction({ game, player, options }) {
          yield* drawCards(game, player, 2, "orderSigil", options);
          game.changeHealing(player.id, 1);
          game.gainEnergy(player.id, "crystal");
        },
      },
      {
        id: "peaceWalker",
        name: "和平行者",
        ...this.onOwnAttack([Timing.ATTACK_DECLARED]),
        filter: ({ context }) =>
          this.isActiveAttack(context) && !!this.state.form,
        resolve({ game, player }) {
          player.hero.state.form = null;
          game.logSkill(
            player.id,
            "peaceWalker",
            "主动攻击，重置并脱离英灵形态",
          );
        },
      },
      {
        id: "warGodRadiance",
        name: "军神威光",
        ...this.onOwnTurn([Timing.TURN_START]),
        filter: () => !!this.state.form,
        *resolve({ game, player }) {
          const choices = [
            { value: "reset", label: "自身+1治疗并重置" },
            ...(game.stoneCounts(player.team).total
              ? [{ value: "stones", label: "移除1至2战绩星石，为目标增加治疗" }]
              : []),
          ];
          const mode = yield* choice(
            player.id,
            "warGodRadiance",
            "军神威光",
            choices,
          );
          if (mode === "reset") {
            game.changeHealing(player.id, 1);
            player.hero.state.form = null;
            game.logSkill(player.id, "warGodRadiance", "重置并脱离英灵形态");
          } else {
            const n = yield* spendStones(game, player, "warGodRadiance");
            yield* healTarget(game, player, n, "warGodRadiance");
          }
        },
      },
      {
        id: "heroicSummon",
        name: "英灵召唤",
        ...this.onOwnAttack([Timing.ATTACK_HIT]),
        filter: ({ game, player }) => game.canPayEnergy(player.id, "crystal"),
        *resolve({ game, player, context, options }) {
          if (!(yield* game.offerSkill(player.id, "heroicSummon", "英灵召唤")))
            return;
          yield* game.paySkillEnergy(player.id, "crystal");
          context.amount++;
          game.logSkill(player.id, "heroicSummon", "攻击伤害+1");
          const cards = player.hand.some((c) => c.type === "spell")
            ? yield* game.chooseHandCards(
                player.id,
                1,
                (c) => c.type === "spell",
                {
                  title: "英灵召唤：可明弃1张法术牌，目标+1治疗",
                  skillId: "heroicSummon",
                  optional: true,
                },
              )
            : null;
          if (cards) {
            yield* discardCost(game, player, cards, "heroicSummon", options);
            yield* healTarget(game, player, 1, "heroicSummon");
          }
          if (game.current === player.id) {
            player.hero.state.form = "英灵";
            game.logSkill(player.id, "peaceWalker", "横置，进入英灵形态");
          }
        },
      },
    ];
  }
}
