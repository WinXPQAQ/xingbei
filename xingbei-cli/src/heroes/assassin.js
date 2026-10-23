import { Hero } from "../hero-base.js";
import { Timing } from "../timing.js";
import { choice, discardCost, hasElement } from "./actions.js";

export class Assassin extends Hero {
  constructor(enabled = true) {
    super({ id: "assassin", name: "暗杀者" });
    if (!enabled) return;
    this.skills = [
      {
        id: "backlash",
        name: "反噬",
        ...this.onDamage([Timing.DAMAGE_AFTER], "target", ["attack"]),
        filter: ({ context }) => context.actual > 0 && context.sourceId != null,
        *resolve({ game, player, context, options }) {
          game.logSkill(player.id, "backlash", `${game.actorLabel(context.sourceId)}强制摸1张牌`);
          yield* game.drawSteps(context.sourceId, 1, {
            ...options,
            cause: { type: "directDraw", skillId: "backlash", sourceId: player.id },
          });
        },
      },
      {
        id: "waterShadow",
        name: "水影",
        ...this.onOwnTurn([Timing.DRAW_BEFORE]),
        filter: ({ game, player, context }) => !context.specialAction && context.count > 0 &&
          player.hand.some((card) => hasElement(game, player, card, "water")),
        *resolve({ game, player, context, options }) {
          const count = player.hand.filter((card) => hasElement(game, player, card, "water")).length;
          const selected = yield* choice(player.id, "waterShadow", "水影：摸牌前可明弃水系牌",
            Array.from({ length: count + 1 }, (_, value) => ({ value, label: value ? `明弃${value}张水系牌` : "不发动" })), 0,
            { drawCount: context.count, cause: context.cause });
          if (!selected) return;
          const cards = yield* game.chooseHandCards(player.id, selected,
            (card) => hasElement(game, player, card, "water"),
            { title: "水影：选择明弃的水系牌", skillId: "waterShadow", context: { drawCount: context.count } });
          game.logSkill(player.id, "waterShadow", `摸牌前明弃${cards.length}张水系牌`);
          yield* discardCost(game, player, cards, "waterShadow", options);
          if (!player.hero.state.form || !player.hand.some((card) => card.type === "spell")) return;
          const extra = yield* game.chooseHandCards(player.id, 1, (card) => card.type === "spell", {
            title: "水影：潜行中可额外明弃1张法术牌", skillId: "waterShadow", optional: true,
            context: { drawCount: context.count, extraSpell: true },
          });
          if (extra) yield* discardCost(game, player, extra, "waterShadow", options);
        },
      },
      {
        id: "stealthReset",
        name: "潜行结束",
        ...this.onOwnTurn([Timing.ACTION_PHASE_START]),
        priority: 100,
        filter: () => !!this.state.form,
        resolve({ game, player }) {
          player.hero.state.form = null;
          game.logSkill(player.id, "stealth", "行动阶段开始，重置并结束潜行");
        },
      },
      {
        id: "stealth",
        name: "潜行",
        ...this.onOwnTurn([Timing.ACTIVATION]),
        filter: ({ game, player }) => game.canPayEnergy(player.id, "gem"),
        modifyHandLimit: (limit) => limit - Number(!!this.state.form),
        *resolve({ game, player, options }) {
          if (!(yield* game.offerSkill(player.id, "stealth", "潜行（消耗1宝石）"))) return;
          yield* game.paySkillEnergy(player.id, "gem");
          const count = yield* choice(player.id, "stealth", "潜行：是否摸1张牌", [
            { value: 0, label: "不摸牌" }, { value: 1, label: "摸1张牌" },
          ], 0, { purpose: "draw" });
          if (count) yield* game.drawSteps(player.id, count, {
            ...options, cause: { type: "directDraw", skillId: "stealth" },
          });
          player.hero.state.form = "潜行";
          game.logSkill(player.id, "stealth", "横置，手牌上限−1；不能成为主动攻击目标");
          // Changing the limit can overflow even when the optional draw was declined.
          yield* game.drawSteps(player.id, 0, {
            ...options, cause: { type: "directDraw", skillId: "stealth" },
          });
        },
      },
      {
        id: "stealthAttack",
        name: "潜行攻击",
        ...this.onOwnAttack([Timing.ATTACK_DECLARED]),
        filter: ({ context }) => !!this.state.form && this.isActiveAttack(context),
        resolve({ game, player, context }) {
          const amount = player.energy.gem + player.energy.crystal;
          context.canCounter = false;
          context.amount += amount;
          game.logSkill(player.id, "stealth", `对${game.actorLabel(context.targetId)}的主动攻击不能应战，伤害+${amount}；仍可使用圣光`);
        },
      },
    ];
  }
  canBeAttackTarget({ isCounter }) {
    return !this.skills.length || !this.state.form || isCounter;
  }
}
