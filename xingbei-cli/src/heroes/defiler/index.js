import { Hero } from "../../hero-base.js";
import { Timing } from "../../timing.js";
import { choice, targets } from "../shared/actions.js";
import { discardHand } from "../shared/covered.js";
export class Defiler extends Hero {
  constructor(enabled = true) {
    super({ id: "defiler", name: "染污者" });
    this.state = { malice: 0, form: null, surgeUsed: false };
    if (!enabled) return;
    const hero = this;
    this.skills = [
      {
        id: "forsakenLineage",
        name: "神弃之裔",
        modifyHealingLimit: () => 0,
        ...this.onDamage([Timing.DAMAGE_BEFORE], "actor"),
        priority: 30,
        filter: ({ game, context }) =>
          game.player(context.targetId).healing > 0,
        resolve({ context }) {
          context.amount++;
        },
      },
      {
        id: "forsakenHealing",
        name: "神弃之裔禁疗",
        ...this.onDamage([Timing.HEALING_BEFORE], "target"),
        priority: -100,
        resolve({ context }) {
          context.healingLimit = 0;
        },
      },
      {
        id: "maliceReset",
        name: "戾如泉涌重置",
        ...this.bind("player", [Timing.TURN_BEFORE], "all"),
        resolve() {
          hero.state.surgeUsed = false;
        },
      },
      {
        id: "maliceSurge",
        name: "戾如泉涌",
        ...this.onOwnTurn([Timing.ATTACK_ACTION_END, Timing.SPELL_ACTION_END]),
        filter: () =>
          !hero.state.form && hero.state.malice < 2 && !hero.state.surgeUsed,
        *resolve({ game, player }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "maliceSurge",
              "戾如泉涌：戾气+1，额外攻击行动",
            ))
          )
            return;
          hero.state.surgeUsed = true;
          hero.state.malice++;
          game.turn.addAttackAction({ sourceSkillId: "maliceSurge" });
        },
      },
      {
        id: "ragingHeart",
        name: "狂戾之心",
        timings: [Timing.TURN_START, Timing.DAMAGE_AFTER],
        bindings: [
          { role: "player", players: "self", timings: [Timing.TURN_START] },
          { role: "target", players: "self", timings: [Timing.DAMAGE_AFTER] },
        ],
        filter: ({ timing, context }) =>
          !hero.state.form &&
          hero.state.malice === 2 &&
          (timing === Timing.TURN_START || context.actual > 0),
        *resolve({ game, player, options }) {
          yield* discardHand(game, player.id, 1, "ragingHeart", options);
          const id = yield* game.choosePlayer(
            player.id,
            targets(game),
            "狂戾之心：移除目标2治疗",
            { skillId: "ragingHeartTarget" },
          );
          game.changeHealing(id, -2);
          hero.state.form = "raging";
          game.logSkill(
            player.id,
            "ragingHeart",
            "进入狂戾形态，不能使用圣光，造成伤害+1",
          );
        },
      },
      {
        id: "ragingDamage",
        name: "狂戾增伤",
        ...this.onDamage([Timing.DAMAGE_BEFORE], "actor"),
        priority: 20,
        filter: () => !!hero.state.form,
        resolve({ context }) {
          context.amount++;
        },
      },
      {
        id: "ragingBody",
        name: "狂戾之体",
        ...this.onDamage([Timing.DAMAGE_BEFORE], "target"),
        priority: -20,
        filter: ({ context }) =>
          !!hero.state.form &&
          hero.state.malice > 0 &&
          context.sourceId != null,
        resolve({ game, player, context }) {
          hero.state.malice--;
          context.amount = Math.min(4, context.amount + 1);
          game.logSkill(
            player.id,
            "ragingBody",
            `戾气−1，本次伤害变为${context.amount}`,
          );
        },
      },
      {
        id: "mindPollution",
        name: "神智污染",
        ...this.onDamage([Timing.DAMAGE_BEFORE], "actor"),
        priority: 10,
        filter: () => !!hero.state.form && hero.state.malice > 0,
        *resolve({ game, player, context }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "mindPollution",
              "神智污染：移除1戾气，伤害+1且不能治疗抵挡",
              context,
            ))
          )
            return;
          hero.state.malice--;
          context.amount++;
          context.noHealing = true;
        },
      },
      {
        id: "pollutionHealing",
        name: "神智污染禁抵挡",
        ...this.onDamage([Timing.HEALING_BEFORE], "actor"),
        priority: -100,
        filter: ({ context }) => !!context.noHealing,
        resolve({ context }) {
          context.healingLimit = 0;
        },
      },
      {
        id: "ragingEnd",
        name: "狂戾之心结束",
        ...this.onOwnTurn([Timing.TURN_END]),
        filter: () => !!hero.state.form && hero.state.malice === 0,
        resolve({ game, player }) {
          hero.state.form = null;
          if (player.energy.crystal) {
            game.payEnergy(player.id, "crystal");
            game.gainEnergy(player.id, "gem");
          }
          game.logSkill(
            player.id,
            "ragingHeart",
            "恢复普通形态，有水晶时转换1水晶为宝石",
          );
        },
      },
      {
        id: "twistedLove",
        name: "扭曲之爱",
        ...this.onOwnTurn([Timing.ACTIVATION]),
        activationEnablesAction: () => true,
        filter: ({ game, player }) => game.canPayEnergy(player.id, "gem"),
        *resolve({ game, player, options }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "twistedLove",
              "扭曲之爱：宝石，调整形态、手牌与戾气",
            ))
          )
            return;
          yield* game.paySkillEnergy(player.id, "gem");
          hero.state.form = yield* choice(
            player.id,
            "twistedForm",
            "选择形态",
            [
              { value: null, label: "普通形态" },
              { value: "raging", label: "狂戾形态" },
            ],
          );
          const mode = yield* choice(player.id, "twistedCards", "调整手牌", [
            { value: "discard", label: "弃2牌" },
            { value: "draw", label: "摸2牌" },
          ]);
          if (mode === "discard")
            yield* discardHand(game, player.id, 2, "twistedLoveCost", options);
          else
            yield* game.drawSteps(player.id, 2, {
              ...options,
              cause: { type: "directDraw", skillId: "twistedLove" },
            });
          hero.state.malice = yield* choice(
            player.id,
            "twistedMalice",
            "调整戾气",
            [0, 1, 2].map((value) => ({ value, label: `${value}戾气` })),
          );
        },
      },
    ];
  }
  initialize(game, p) {
    if (this.skills.length) game.gainEnergy(p.id, "crystal");
  }
  blocksHealing({ player, targetId }) {
    return !!this.skills.length && player.id === targetId;
  }
  allowsCard({ card }) {
    return !this.state.form || card.name !== "holyLight";
  }
}
