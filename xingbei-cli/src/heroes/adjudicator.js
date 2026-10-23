import { Hero } from "../hero-base.js";
import { Timing } from "../timing.js";
import { targets, discardCost } from "./actions.js";

function addJudgment(game, player, skillId, amount = 1) {
  const state = player.hero.state;
  const added = Math.min(amount, Math.max(0, 4 - state.judgment));
  state.judgment += added;
  game.logSkill(player.id, skillId, `审判+${added}（${state.judgment}/4）`);
}

export class Adjudicator extends Hero {
  constructor(enabled = true) {
    super({ id: "adjudicator", name: "仲裁者" });
    this.state.judgment = 0;
    this.state.requiredJudgment = false;
    if (!enabled) return;
    this.skills = [
      { id: "judgmentLaw", name: "仲裁法则" },
      {
        id: "ritualBreak",
        name: "仪式中断",
        ...this.onOwnTurn([Timing.ACTIVATION]),
        filter: ({ context }) => this.state.form && !context.usedSkills.judgmentActivation,
        *resolve({ game, player, context }) {
          if (!(yield* game.offerSkill(player.id, "ritualBreak", "仪式中断"))) return;
          context.usedSkills.judgmentActivation = true;
          player.hero.state.form = null;
          const added = game.addStones(player.team, "gem");
          game.logSkill(player.id, "ritualBreak", `脱离审判形态；战绩区获得${added}宝石`);
        },
      },
      {
        id: "finalJudgment",
        name: "末日审判",
        action(game, player) {
          return player.hero.state.judgment > 0
            ? { type: "spell", targets: targets(game) }
            : null;
        },
        *resolveAction({ game, player, targetIds, options }) {
          const amount = player.hero.state.judgment;
          player.hero.state.judgment = 0;
          player.hero.state.requiredJudgment = false;
          game.logSkill(player.id, "finalJudgment", `移除${amount}审判；对${game.actorLabel(targetIds[0])}造成${amount}点法术伤害`);
          yield* game.damageSteps(targetIds[0], amount, {
            ...options, sourceId: player.id, damageType: "spell", skillId: "finalJudgment",
          });
        },
        ...this.onOwnTurn([Timing.ACTION_PHASE_START, Timing.TURN_END]),
        resolve({ game, player, timing }) {
          player.hero.state.requiredJudgment = timing === Timing.ACTION_PHASE_START && player.hero.state.judgment >= 4;
          if (player.hero.state.requiredJudgment)
            game.logSkill(player.id, "finalJudgment", "审判已满，本行动阶段必须发动末日审判");
        },
      },
      {
        id: "judgmentWave",
        name: "审判浪潮",
        ...this.onDamage([Timing.DAMAGE_AFTER], "target"),
        // The original engine stops damage at zero before its after-damage event.
        filter: ({ context }) => context.actual > 0,
        resolve({ game, player }) { addJudgment(game, player, "judgmentWave"); },
      },
      {
        id: "judgmentRitual",
        name: "仲裁仪式",
        ...this.onOwnTurn([Timing.ACTIVATION, Timing.TURN_START]),
        modifyHandLimit: (limit) => this.state.form ? 5 : limit,
        filter: ({ game, player, timing, context }) => timing === Timing.TURN_START
          ? !!this.state.form
          : !this.state.form && !context.usedSkills.judgmentActivation && game.canPayEnergy(player.id, "gem"),
        *resolve({ game, player, timing, context, options }) {
          if (timing === Timing.TURN_START) {
            addJudgment(game, player, "judgmentRitual");
            return;
          }
          if (!(yield* game.offerSkill(player.id, "judgmentRitual", "仲裁仪式"))) return;
          context.usedSkills.judgmentActivation = true;
          yield* game.paySkillEnergy(player.id, "gem");
          player.hero.state.form = "审判";
          game.logSkill(player.id, "judgmentRitual", "进入审判形态；手牌上限恒定为5");
          yield* game.drawSteps(player.id, 0, {
            ...options, cause: { type: "handLimit", skillId: "judgmentRitual" },
          });
        },
      },
      {
        id: "judgmentBalance",
        name: "判决天平",
        action(game, player, action = {}) {
          const modes = [
            { value: "discard", label: "暗弃所有手牌" },
            { value: "refill", label: "补至手牌上限，战绩区获得1宝石" },
          ];
          if (action.mode != null && !modes.some((mode) => mode.value === action.mode)) return null;
          return { type: "spell", energy: "crystal", targets: [], targetCount: 0, modes };
        },
        *resolveAction({ game, player, action, options }) {
          yield* game.paySkillEnergy(player.id, "crystal");
          addJudgment(game, player, "judgmentBalance");
          if ((action.mode ?? "discard") === "discard") {
            yield* discardCost(game, player, [...player.hand], "judgmentBalance", options, "hidden");
          } else {
            yield* game.drawSteps(player.id, Math.max(0, player.handLimit - player.hand.length), {
              ...options, cause: { type: "directDraw", skillId: "judgmentBalance" },
            });
            const added = game.addStones(player.team, "gem");
            game.logSkill(player.id, "judgmentBalance", `战绩区获得${added}宝石`);
          }
        },
      },
    ];
  }

  initialize(game, player) {
    if (!this.skills.length) return;
    game.logSkill(player.id, "judgmentLaw", "开局获得2水晶");
    game.gainEnergy(player.id, "crystal", 2);
  }

  allowsAction({ type, skillId }) {
    return !this.state.requiredJudgment || (type === "spell" && skillId === "finalJudgment");
  }
}
