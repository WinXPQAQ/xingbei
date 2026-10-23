import { Hero } from "../../hero-base.js";
import { Timing } from "../../timing.js";
import { targets, discardCost, useUnique } from "../shared/actions.js";

const teammates = (game, player) => game.players
  .filter((target) => target.team === player.team && target.id !== player.id)
  .map((target) => target.id);

export const prayerEffects = {
  powerBlessing: {
    id: "powerBlessing", name: "威力赐福", category: "basic", stackable: false,
    priority: -1, timings: [Timing.ATTACK_HIT],
    bindings: [{ role: "actor", players: "self" }],
    *resolve({ game, player, card, context }) {
      if (!(yield* game.offerSkill(player.id, "powerBlessing", "威力赐福", context))) return;
      game.removeEffect(card.id);
      context.amount += 2;
      game.logSkill(player.id, "powerBlessing", `移除基础效果，本次攻击伤害+2，变为${context.amount}`);
    },
  },
  speedBlessing: {
    id: "speedBlessing", name: "迅捷赐福", category: "basic", stackable: false,
    timings: [Timing.ATTACK_ACTION_END, Timing.SPELL_ACTION_END],
    bindings: [{ role: "player", players: "self" }],
    *resolve({ game, player, card }) {
      if (!(yield* game.offerSkill(player.id, "speedBlessing", "迅捷赐福"))) return;
      game.removeEffect(card.id);
      game.turn.addAttackAction({ sourceSkillId: "speedBlessing" });
    },
  },
};

export class Prayer extends Hero {
  constructor(enabled = true) {
    super({ id: "prayer", name: "祈祷师" });
    this.state = { form: null, prayerRunes: 0 };
    if (!enabled) return;
    this.skills = [
      {
        id: "radiantFaith", name: "光辉信仰",
        action(game, player) {
          if (player.hero.state.form !== "prayer" || player.hero.state.prayerRunes < 1) return null;
          return { type: "spell", targets: teammates(game, player) };
        },
        *resolveAction({ game, player, targetIds, options }) {
          player.hero.state.prayerRunes--;
          const count = Math.min(2, player.hand.length);
          game.logSkill(player.id, "radiantFaith", `移除1祈祷符文（剩余${player.hero.state.prayerRunes}）`);
          if (count) {
            const cards = yield* game.chooseHandCards(player.id, count, () => true, {
              title: "光辉信仰：弃牌", skillId: "radiantFaith",
            });
            yield* discardCost(game, player, cards, "radiantFaith", options, "hidden");
          }
          const gained = game.addStones(player.team, "gem");
          game.logSkill(player.id, "radiantFaith", `战绩区+${gained}宝石；${game.actorLabel(targetIds[0])}+1治疗`);
          game.changeHealing(targetIds[0], 1);
        },
      },
      {
        id: "darkCurse", name: "黑暗诅咒",
        action(game, player) {
          return player.hero.state.form === "prayer" && player.hero.state.prayerRunes > 0
            ? { type: "spell", targets: targets(game) } : null;
        },
        *resolveAction({ game, player, targetIds, options }) {
          player.hero.state.prayerRunes--;
          game.logSkill(player.id, "darkCurse", `移除1祈祷符文（剩余${player.hero.state.prayerRunes}），先目标后自身各2法术伤害`);
          for (const targetId of [targetIds[0], player.id])
            yield* game.damageSteps(targetId, 2, {
              ...options, sourceId: player.id, damageType: "spell", skillId: "darkCurse",
            });
        },
      },
      ...["powerBlessing", "speedBlessing"].map((id) => ({
        id, name: prayerEffects[id].name,
        action(game, player) {
          return {
            type: "spell", cardCount: 1, cardFilter: (card) => card.hasUniqueSkill(id),
            targets: teammates(game, player).filter((targetId) => !game.player(targetId).getStatus(id).length),
          };
        },
        *resolveAction({ game, player, cards, targetIds, options }) {
          yield* useUnique(game, player, cards[0], options);
          game.attachCard(cards[0].id, targetIds[0], {
            effectId: id, sourcePlayerId: player.id, sourceSkillId: id,
          });
        },
      })),
      {
        id: "prayer", name: "祈祷",
        ...this.onOwnTurn([Timing.ACTIVATION]),
        filter: ({ game, player }) => !this.state.form && game.canPayEnergy(player.id, "gem"),
        *resolve({ game, player }) {
          if (!(yield* game.offerSkill(player.id, "prayer", "祈祷"))) return;
          yield* game.paySkillEnergy(player.id, "gem");
          player.hero.state.form = "prayer";
          game.logSkill(player.id, "prayer", "横置，进入祈祷形态");
        },
      },
      {
        id: "prayerRunes", name: "祈祷符文",
        ...this.onOwnAttack([Timing.ATTACK_DECLARED]),
        filter: ({ context }) => this.state.form === "prayer" && this.isActiveAttack(context),
        resolve: ({ game, player }) => {
          const before = this.state.prayerRunes;
          this.state.prayerRunes = Math.min(3, before + 2);
          game.logSkill(player.id, "prayer", `主动攻击，祈祷符文+${this.state.prayerRunes - before}（${this.state.prayerRunes}/3）`);
        },
      },
      {
        id: "manaTide", name: "法力潮汐",
        ...this.onOwnTurn([Timing.SPELL_ACTION_END]),
        filter: ({ game, player }) => !game.turn.state?.usedSkills[`manaTide:${player.id}`] && game.canPayEnergy(player.id, "crystal"),
        *resolve({ game, player }) {
          if (!(yield* game.offerSkill(player.id, "manaTide", "法力潮汐"))) return;
          if (game.turn.state) game.turn.state.usedSkills[`manaTide:${player.id}`] = true;
          yield* game.paySkillEnergy(player.id, "crystal");
          game.turn.addAction({ type: "spell", sourceSkillId: "manaTide" });
        },
      },
    ];
  }

  initialize(game) {
    if (!this.skills.length) return;
    for (const [id, effect] of Object.entries(prayerEffects))
      if (!game.effects.has(id)) game.registerEffect(id, effect);
  }
}
