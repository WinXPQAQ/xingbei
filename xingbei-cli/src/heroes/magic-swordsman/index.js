import { Hero } from "../../hero-base.js";
import { RuleError } from "../../errors.js";
import { Timing } from "../../timing.js";
import { choice, discardCost, hasElement, targets } from "../shared/actions.js";

export class MagicSwordsman extends Hero {
  constructor(enabled = true) {
    super({ id: "magicSwordsman", name: "魔剑士" });
    if (!enabled) return;
    this.skills = [
      {
        id: "asuraCombo",
        name: "修罗连斩",
        ...this.onOwnTurn([Timing.ATTACK_ACTION_END]),
        filter: ({ game, player, context }) => !context.usedSkills.asuraCombo &&
          player.hand.some((card) => card.type === "attack" && hasElement(game, player, card, "fire")),
        *resolve({ game, player, context }) {
          if (!(yield* game.offerSkill(player.id, "asuraCombo", "修罗连斩：额外火系攻击行动"))) return;
          context.usedSkills.asuraCombo = true;
          game.turn.addAttackAction({ element: "fire", sourceSkillId: "asuraCombo" });
        },
      },
      {
        id: "shadowReset",
        name: "暗影结束",
        ...this.onOwnTurn([Timing.ACTION_PHASE_START]),
        priority: 100,
        filter: () => !!this.state.form,
        resolve({ game, player }) {
          player.hero.state.form = null;
          game.logSkill(player.id, "shadowGathering", "行动阶段开始，重置并脱离暗影形态");
        },
      },
      {
        id: "shadowGathering",
        name: "暗影凝聚",
        ...this.onOwnTurn([Timing.ACTIVATION]),
        filter: () => !this.state.form,
        *resolve({ game, player, options }) {
          if (!(yield* game.offerSkill(player.id, "shadowGathering", "暗影凝聚：对自身造成1法术伤害"))) return;
          yield* game.damageSteps(player.id, 1, {
            ...options, sourceId: player.id, damageType: "spell", skillId: "shadowGathering",
          });
          player.hero.state.form = "暗影";
          game.logSkill(player.id, "shadowGathering", "横置，进入暗影形态");
        },
      },
      {
        id: "shadowPower",
        name: "暗影之力",
        ...this.onOwnAttack([Timing.ATTACK_DECLARED]),
        filter: () => !!this.state.form,
        resolve({ game, player, context }) {
          context.amount++;
          game.logSkill(player.id, "shadowPower", `对${game.actorLabel(context.targetId)}的攻击伤害+1`);
        },
      },
      { id: "shadowResistance", name: "暗影抗拒" },
      {
        id: "shadowMeteor",
        name: "暗影流星",
        action(game, player) {
          const state = game.turn.state;
          // Before activation this can be chosen as the planned spell action;
          // declining Gathering makes the common post-activation validation fail.
          if (!player.hero.state.form && (!state || state.activationDone || state.completed)) return null;
          return {
            type: "spell", cardCount: 2, cardFilter: (card) => card.type === "spell",
            targets: targets(game),
            ...(!player.hero.state.form ? { requiresActivation: "shadowGathering" } : {}),
          };
        },
        *resolveAction({ game, player, cards, targetIds, options }) {
          if (!player.hero.state.form) throw new RuleError("暗影流星需要暗影形态");
          yield* discardCost(game, player, cards, "shadowMeteor", options);
          yield* game.damageSteps(targetIds[0], 2, {
            ...options, sourceId: player.id, damageType: "spell", skillId: "shadowMeteor",
          });
          const available = game.stoneCounts(player.team);
          if (available.total < 2) return;
          const choices = [{ value: "keep", label: "保留暗影形态" }];
          for (let gem = 0; gem <= 2; gem++) {
            const crystal = 2 - gem;
            if (gem <= available.gem && crystal <= available.crystal)
              choices.push({ value: `${gem}:${crystal}`, label: `移除${gem}宝石、${crystal}水晶，重置并获得1宝石` });
          }
          const selected = yield* choice(player.id, "shadowMeteor", "暗影流星：是否移除2战绩星石", choices, "keep");
          if (selected === "keep") return;
          const [gem, crystal] = selected.split(":").map(Number);
          game.removeStones(player.team, { gem, crystal });
          player.hero.state.form = null;
          game.gainEnergy(player.id, "gem");
          game.logSkill(player.id, "shadowMeteor", `移除战绩区${gem}宝石、${crystal}水晶，重置并脱离暗影形态`);
        },
      },
      {
        id: "hadesTremor",
        name: "黄泉震颤",
        ...this.onOwnAttack([Timing.ATTACK_DECLARED, Timing.ATTACK_HIT]),
        filter: ({ game, player, timing, context }) => timing === Timing.ATTACK_HIT
          ? !!context.hadesTremor
          : this.isActiveAttack(context) && !game.turn.state?.usedSkills.hadesTremor && game.canPayEnergy(player.id, "gem"),
        *resolve({ game, player, timing, context, options }) {
          if (timing === Timing.ATTACK_DECLARED) {
            if (!(yield* game.offerSkill(player.id, "hadesTremor", "黄泉震颤（消耗1宝石）", context))) return;
            yield* game.paySkillEnergy(player.id, "gem");
            if (game.turn.state) game.turn.state.usedSkills.hadesTremor = true;
            context.hadesTremor = true;
            context.canCounter = false;
            game.logSkill(player.id, "hadesTremor", `对${game.actorLabel(context.targetId)}的攻击不能应战；命中后补手并暗弃2牌`);
            return;
          }
          const count = Math.max(0, player.handLimit - player.hand.length);
          yield* game.drawSteps(player.id, count, {
            ...options, cause: { type: "directDraw", skillId: "hadesTremor" },
          });
          const discardCount = Math.min(2, player.hand.length);
          if (!discardCount) return;
          const cards = yield* game.chooseHandCards(player.id, discardCount, () => true, {
            title: "黄泉震颤：暗弃2张牌", skillId: "hadesTremor",
          });
          yield* discardCost(game, player, cards, "hadesTremor", options, "hidden");
        },
      },
    ];
  }
  allowsCard({ game, player, card, purpose }) {
    if (!this.skills.length || card.type !== "spell") return true;
    return purpose !== "action" && game.turn.state?.playerId !== player.id;
  }
}
