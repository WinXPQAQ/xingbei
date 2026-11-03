import { Ecclesiastic } from "./shared.js";
import { Timing } from "../../timing.js";
import { choice, targets, healTarget } from "../shared/actions.js";
import { discardHand, coveredCards } from "../shared/covered.js";
export class Lawgiver extends Ecclesiastic {
  constructor(enabled = true) {
    super("lawgiver", "铸律者");
    if (!enabled) return;
    const hero = this;
    this.skills = [
      { id: "royalPressure", name: "圣律威压" },
      { id: "orbReturn", name: "神言咏赞" },
      {
        id: "lawReset",
        name: "圣银颂恩重置",
        ...this.bind("player", [Timing.TURN_BEFORE], "all"),
        resolve() {
          hero.state.silverGraceUsed = false;
        },
      },
      {
        id: "divineLaw",
        name: "神律封锁",
        ...this.bind("player", [Timing.HEALING_CHANGED], "all"),
        *resolve({ game, player, context, options }) {
          if (
            context.playerId === player.id &&
            context.heroId === "lawgiver" &&
            context.amount > 0
          )
            yield* game.changeMoraleSteps(player.team, -1, {
              ...options,
              floor: 1,
              skillId: "divineLaw",
            });
          yield* hero.settleLimits(game, options);
        },
      },
      {
        id: "holyBloodStrike",
        name: "圣血之击",
        ...this.onOwnAttack([Timing.ATTACK_HIT]),
        filter: ({ context }) => hero.isActiveAttack(context),
        *resolve({ game, player, context, options }) {
          context.amount++;
          game.changeHealing(player.id, 1);
          yield* game.flushRuleEvents(options);
        },
      },
      {
        id: "castling",
        name: "王车易位",
        action: (g) =>
          g.players.reduce((n, p) => n + p.healing, 0) >= 2
            ? { type: "spell", targetCount: 0 }
            : null,
        *resolveAction({ game, player, options }) {
          yield* hero.removeHealing(game, player, false, "castlingHealing");
          hero.gain(game, player, "silverBullets", 2, "castling");
          yield* hero.cleanse(game, player, options);
          yield* hero.replace(game, player, "cardinal", options);
          game.turn.addAttackAction({ sourceSkillId: "castling" });
        },
      },
      hero.prevention(),
      {
        id: "silverGrace",
        name: "圣银颂恩",
        ...this.onOwnTurn([Timing.ATTACK_ACTION_END]),
        filter: () =>
          !hero.state.silverGraceUsed && hero.state.silverBullets >= 2,
        *resolve({ game, player }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "silverGrace",
              "圣银颂恩：2银制子弹，额外攻击并发放1治疗",
            ))
          )
            return;
          hero.state.silverGraceUsed = true;
          hero.state.silverBullets -= 2;
          game.logSkill(player.id, "silverGrace", "移除2银制子弹");
          game.turn.addAttackAction({ sourceSkillId: "silverGrace" });
          yield* healTarget(game, player, 1, "silverGraceTarget");
        },
      },
      {
        id: "faithReforged",
        name: "信仰重铸",
        ...this.onOwnTurn([Timing.TURN_END]),
        filter: ({ game, player, context }) =>
          context.route !== "special" &&
          player.hand.length > 0 &&
          game.canPayEnergy(player.id, "crystal"),
        *resolve({ game, player, options }) {
          const cs = yield* game.chooseHandCards(player.id, 1, () => true, {
            skillId: "faithReforged",
            optional: true,
            title: "信仰重铸：水晶，将1手牌展示放到王权宝珠上",
          });
          if (!cs) return;
          yield* game.paySkillEnergy(player.id, "crystal");
          game.coverCards(player.id, cs, "orbOffering", { reveal: true });
          yield* game.flushRuleEvents(options);
          yield* game.drawSteps(player.id, 1, options);
          hero.gain(game, player, "relics", 2, "faithReforged");
          yield* hero.orbCircuit(game, player, cs[0], options);
        },
      },
    ];
  }
  modifyOtherHandLimit(limit, { game, player, target }) {
    return this.skills.length &&
      player.healing < game.getHealingLimit(player.id) &&
      target.healing === 0
      ? Math.max(0, limit - 1)
      : limit;
  }
  *orbCircuit(g, p, offering, options) {
    const offeringType = offering.category === "exclusive" ? "exclusive" : offering.type;
    const matches = c => (c.category === "exclusive" ? "exclusive" : c.type) === offeringType;
    let id = p.id;
    try {
      for (let step = 0; step < g.players.length && !g.winner; step++) {
        g.attachCard(this.state.orbCardId, id, {
          effectId: "royalOrb",
          sourcePlayerId: p.id,
        });
        const cs = g.player(id).hand.some(matches)
          ? yield* g.chooseHandCards(id, 1, matches, {
              skillId: "royalPressure",
              context: { sourceId: p.id },
              optional: true,
              title: "圣律威压：明弃同类型牌，或摸2牌使铸律者方士气−1",
            })
          : null;
        if (cs) {
          g.discardCards(id, cs, { reason: "royalPressure" });
          yield* g.flushRuleEvents(options);
        } else {
          yield* g.drawSteps(id, 2, options);
          yield* g.changeMoraleSteps(p.team, -1, {
            ...options,
            skillId: "royalPressure",
          });
          if (this.state.relics < 1) return;
        }
        id = (id + 1) % g.players.length;
      }
      g.attachCard(this.state.orbCardId, p.id, {
        effectId: "royalOrb",
        sourcePlayerId: p.id,
      });
      const choices = [
        { value: "cardinal", label: "替换为红衣主教" },
        ...Array.from(
          { length: Math.min(2, this.state.silverBullets) + 1 },
          (_, value) => ({
            value,
            label: `移除${value}银制子弹，使目标摸${value}牌`,
          }),
        ),
      ];
      const mode = yield* choice(p.id, "orbReturn", "王权宝珠返回", choices);
      if (mode === "cardinal") yield* this.replace(g, p, "cardinal", options);
      else {
        this.state.silverBullets -= mode;
        if (mode) {
          const id = yield* g.choosePlayer(
            p.id,
            targets(g),
            "神言咏赞：摸牌目标",
            { skillId: "orbDrawTarget" },
          );
          yield* g.drawSteps(id, mode, options);
        }
      }
    } finally {
      const orb = g.cards.get(this.state.orbCardId);
      if (orb.location.zone === "status")
        g.removeEffect(orb.id, { zone: "outside" });
      if (offering.location.zone === "covered")
        g.discardCovered(p.id, offering, {
          reveal: true,
          skillId: "faithReforged",
        });
    }
  }
}
