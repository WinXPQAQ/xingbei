import { Hero } from "../../hero-base.js";
import { Timing } from "../../timing.js";
import { choice, enemies, healTarget } from "../shared/actions.js";
import { discardHand } from "../shared/covered.js";
export class Templar extends Hero {
  constructor(enabled = true) {
    super({ id: "templar", name: "圣殿骑士" });
    this.state = {
      holySeals: 0,
      form: null,
      awaitNextTurn: false,
      divineMightBlocked: false,
      healingBlockedIds: [],
    };
    if (!enabled) return;
    const hero = this;
    this.skills = [
      {
        id: "chosenOne",
        name: "神选者",
        modifyHealingLimit: (n) => n - 1,
        ...this.onOwnAttack([Timing.ATTACK_HIT]),
        filter: ({ context }) => hero.isActiveAttack(context),
        resolve({ game, player }) {
          game.changeHealing(player.id, 1);
        },
      },
      {
        id: "chosenOverflow",
        name: "神选者溢出",
        ...this.onOwnTurn([Timing.HEALING_OVERFLOW]),
        resolve({ game, player }) {
          hero.gainSeals(game, player, 1);
        },
      },
      {
        id: "templarTurn",
        name: "圣炎期限",
        ...this.bind("player", [Timing.TURN_BEFORE, Timing.TURN_END], "all"),
        priority: -50,
        *resolve({ game, player, context, timing, options }) {
          if (timing === Timing.TURN_BEFORE) {
            hero.state.divineMightBlocked = false;
            hero.state.healingBlockedIds = [];
            if (context.playerId === player.id && hero.state.form)
              hero.state.awaitNextTurn = false;
          } else {
            if (
              context.playerId === player.id &&
              hero.state.form &&
              !hero.state.awaitNextTurn
            ) {
              yield* hero.resetFlame(game, player, options);
              const id = yield* game.choosePlayer(
                player.id,
                enemies(game, player),
                "神之子：选择1法伤目标",
                { skillId: "divineChildTarget" },
              );
              yield* game.damageSteps(id, 1, {
                ...options,
                sourceId: player.id,
                damageType: "spell",
                skillId: "divineChild",
              });
            }
            hero.state.healingBlockedIds = [];
          }
        },
      },
      {
        id: "divineMight",
        name: "神威",
        ...this.onOwnAttack([Timing.ATTACK_DECLARED]),
        priority: 30,
        filter: ({ context }) =>
          hero.isActiveAttack(context) &&
          hero.state.holySeals >= 2 &&
          !hero.state.divineMightBlocked,
        *resolve({ game, player, context }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "divineMight",
              "神威：2圣印，无法应战，本回合双方无法获疗",
              context,
            ))
          )
            return;
          hero.state.holySeals -= 2;
          context.canCounter = false;
          if (context.attackTraits.fates.includes("S")) context.amount++;
          hero.state.healingBlockedIds = [
            ...new Set([
              ...hero.state.healingBlockedIds,
              player.id,
              context.targetId,
            ]),
          ];
          game.logSkill(
            player.id,
            "divineMight",
            `消耗2圣印，${game.actorLabel(context.targetId)}无法应战，双方本回合不能获得治疗`,
          );
        },
      },
      {
        id: "holyJudgment",
        name: "圣裁",
        ...this.onOwnAttack([Timing.ATTACK_DECLARED]),
        priority: 20,
        filter: ({ context }) =>
          hero.isActiveAttack(context) && hero.state.holySeals > 0,
        *resolve({ game, player, context, options }) {
          const n = yield* choice(
            player.id,
            "holyJudgment",
            "圣裁：选择圣印费用",
            Array.from({ length: hero.state.holySeals + 1 }, (_, value) => ({
              value,
              label: value ? `${value}圣印` : "不发动",
            })),
            0,
            context,
          );
          if (!n) return;
          hero.state.holySeals -= n;
          context.amount += n - 1;
          yield* game.damageSteps(context.targetId, 1, {
            ...options,
            sourceId: player.id,
            damageType: "spell",
            skillId: "holyJudgment",
          });
        },
      },
      {
        id: "holyOracle",
        name: "圣愈",
        action: (game, p) =>
          hero.state.holySeals
            ? {
                type: "spell",
                modes: Array.from({ length: hero.state.holySeals }, (_, i) => ({
                  value: String(i + 1),
                  label: `移除${i + 1}圣印，队友治疗+${i + 1}`,
                })),
                targets: game.players
                  .filter((t) => t.team === p.team && t.id !== p.id)
                  .map((t) => t.id),
              }
            : null,
        *resolveAction({ game, player, action, targetIds, options }) {
          const n = Number(action.mode);
          hero.state.holySeals -= n;
          game.changeHealing(targetIds[0], n);
          yield* discardHand(game, player.id, 1, "holyOracle", options);
          game.turn.addAttackAction({ sourceSkillId: "holyOracle" });
        },
      },
      {
        id: "divineChild",
        name: "神之子",
        ...this.onDamage([Timing.DAMAGE_BEFORE], "target"),
        priority: -100,
        filter: () => !!hero.state.form,
        *resolve({ game, player, context, options }) {
          context.amount = 0;
          game.logSkill(
            player.id,
            "divineChild",
            "抵御原伤害，改为时点6自身1法伤",
          );
          yield* game.damageAtPointSixSteps(
            {
              actorId: player.id,
              sourceId: player.id,
              targetId: player.id,
              amount: 1,
              actual: 1,
              damageType: "spell",
              skillId: "divineChild",
            },
            options,
          );
          yield* hero.resetFlame(game, player, options);
        },
      },
      {
        id: "divineDescent",
        name: "神临圣启",
        action: () => ({ type: "spell", energy: "crystal", targetCount: 0 }),
        *resolveAction({ game, player }) {
          yield* game.paySkillEnergy(player.id, "crystal");
          hero.gainSeals(game, player, 2, 4);
          hero.state.divineMightBlocked = true;
          game.turn.addAttackAction({ sourceSkillId: "divineDescent" });
        },
      },
      { id: "flamePrayer", name: "圣炎祈愿" },
    ];
  }
  gainSeals(game, p, n, cap = 2) {
    const before = this.state.holySeals;
    this.state.holySeals = Math.max(before, Math.min(cap, before + n));
    const actual = this.state.holySeals - before;
    game.logSkill(
      p.id,
      "chosenOne",
      `圣印+${actual}（${this.state.holySeals}）`,
    );
    if (actual && !this.state.form) {
      this.state.form = "holyFlame";
      this.state.awaitNextTurn = true;
      game.changeHealing(p.id, -p.healing);
      game.logSkill(
        p.id,
        "divineChild",
        "进入圣炎形态，移除全部治疗，我方士气最低1",
      );
    }
  }
  moraleFloor({ player, team }) {
    return this.state.form && team === player.team ? 1 : -Infinity;
  }
  blocksHealing({ targetId }) {
    return this.state.healingBlockedIds.includes(targetId);
  }
  *resetFlame(game, p, options) {
    this.state.form = null;
    this.state.awaitNextTurn = false;
    game.logSkill(p.id, "divineChild", "脱离圣炎形态");
    if (
      game.canPayEnergy(p.id, "crystal") &&
      (yield* game.offerSkill(
        p.id,
        "flamePrayer",
        "圣炎祈愿：1水晶，目标+2治疗",
      ))
    ) {
      yield* game.paySkillEnergy(p.id, "crystal");
      yield* healTarget(game, p, 2, "flamePrayer");
    }
  }
}
