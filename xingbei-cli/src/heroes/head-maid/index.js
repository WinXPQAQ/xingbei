import { Hero } from "../../hero-base.js";
import { ExclusiveCard } from "../../card.js";
import { Timing } from "../../timing.js";
import { choice, targets, enemies } from "../shared/actions.js";
import { coveredCards, trimCovered, discardHand } from "../shared/covered.js";
import { selectCovered } from "../shared/selection.js";
import { chooseVisibleCard, gainCard } from "../shared/compound.js";
export class HeadMaid extends Hero {
  constructor(enabled = true) {
    super({ id: "headMaid", name: "女仆长" });
    this.state = {
      threads: 0,
      form: null,
      flashUsed: false,
      flashActive: false,
      tunnelCardId: null,
      windHitCardId: null,
    };
    if (!enabled) return;
    const hero = this;
    this.skills = [
      {
        id: "maidReset",
        name: "瞬影重置",
        ...this.bind("player", [Timing.TURN_BEFORE], "all"),
        resolve() {
          hero.state.flashUsed = false;
          hero.state.flashActive = false;
        },
      },
      {
        id: "shadowHole",
        name: "影之穴",
        ...this.onOwnTurn([Timing.ACTIVATION]),
        filter: () => hero.state.threads > 0,
        *resolve({ game, player, context, options }) {
          if (
            context.usedSkills?.maidActivation ||
            !(yield* game.offerSkill(
              player.id,
              "shadowHole",
              "影之穴：1糸，放置风穴并令目标弃1牌",
            ))
          )
            return;
          if (context.usedSkills) context.usedSkills.maidActivation = true;
          hero.state.threads--;
          const id = yield* game.choosePlayer(
            player.id,
            enemies(game, player),
            "放置风穴",
            { skillId: "shadowHoleTarget" },
          );
          game.attachCard(hero.state.tunnelCardId, id, {
            effectId: "windTunnel",
            sourcePlayerId: player.id,
          });
          yield* discardHand(game, id, 1, "shadowHoleCost", options);
        },
      },
      {
        id: "trueShadow",
        name: "真·摹影",
        ...this.onOwnTurn([Timing.ACTIVATION]),
        filter: ({ game, player, context }) =>
          !context.usedSkills?.maidActivation &&
          game.canPayEnergy(player.id, "gem") &&
          player.hand.length >= 2,
        *resolve({ game, player, context, options }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "trueShadow",
              "真·摹影：宝石，将2张手牌作为影",
            ))
          )
            return;
          if (context.usedSkills) context.usedSkills.maidActivation = true;
          yield* game.paySkillEnergy(player.id, "gem");
          const cs = yield* game.chooseHandCards(player.id, 2, () => true, {
            skillId: "trueShadowCards",
          });
          yield* hero.addShadows(game, player, cs, options);
        },
      },
      {
        id: "shadowCopy",
        name: "秘术·摹影",
        ...this.onOwnAttack([Timing.ATTACK_HIT]),
        filter: ({ context }) =>
          hero.isActiveAttack(context) &&
          !hero.state.flashActive &&
          context.card?.location?.zone === "field",
        *resolve({ game, player, context, options }) {
          if (
            yield* game.offerSkill(
              player.id,
              "shadowCopy",
              "秘术·摹影：将命中牌作为影",
            )
          )
            yield* hero.addShadows(game, player, [context.card], options);
        },
      },
      {
        id: "flashKill",
        name: "瞬·影·杀",
        ...this.onOwnAttack([Timing.ATTACK_MISS]),
        filter: ({ player, context }) =>
          hero.isActiveAttack(context) &&
          !hero.state.flashUsed &&
          hero.shadows(player).length > 0,
        *resolve({ game, player }) {
          const c = yield* game.chooseCoveredCard(player.id, "shadow", {
            skillId: "flashKill",
            optional: true,
          });
          if (!c) return;
          game.discardCovered(player.id, c, { skillId: "flashKill" });
          hero.state.flashUsed = true;
          hero.state.flashActive = true;
          game.turn.addAttackAction({ sourceSkillId: "flashKill" });
        },
      },
      {
        id: "flashAttack",
        name: "瞬影无法应战",
        ...this.onOwnAttack([Timing.ATTACK_DECLARED]),
        priority: 40,
        filter: ({ context }) =>
          hero.state.flashActive && hero.isActiveAttack(context),
        resolve({ context }) {
          context.canCounter = false;
        },
      },
      {
        id: "shadowStitch",
        name: "影缝",
        ...this.bind("player", [Timing.TURN_START], "all"),
        filter: ({ game, context }) =>
          hero.holder(game) === context.playerId && hero.state.threads > 0,
        *resolve({ game, player, context, options }) {
          const n = yield* choice(
            player.id,
            "shadowStitch",
            "影缝：选择糸数量",
            Array.from(
              { length: Math.min(3, hero.state.threads) + 1 },
              (_, value) => ({ value, label: value ? `${value}糸` : "不发动" }),
            ),
            0,
            { targetId: context.playerId },
          );
          if (!n) return;
          hero.state.threads -= n;
          const cs = yield* discardHand(
            game,
            context.playerId,
            n,
            "shadowStitchCost",
            options,
          );
          if (cs.length) {
            const c = yield* chooseVisibleCard(
              game,
              player.id,
              cs,
              "shadowStitchCard",
              "观看弃牌，选择1张作为影",
            );
            yield* hero.addShadows(game, player, [c], options);
          }
          if (cs.length < n)
            yield* game.changeMoraleSteps(game.player(context.playerId).team, -1, {...options, skillId: "shadowStitch"});
        },
      },
      {
        id: "wayOfService",
        name: "侍奉之道",
        ...this.onOwnTurn([Timing.TURN_END]),
        filter: ({ player }) => hero.shadows(player).length >= 2,
        *resolve({ game, player, options }) {
          const cs = yield* selectCovered(game, player, "shadow", {
            skillId: "wayOfService",
            min: 2,
            max: 2,
            optional: true,
          });
          if (!cs.length) return;
          const same = cs[0]
            .getTraits({ game, playerId: player.id })
            .elements.some((e) =>
              cs[1]
                .getTraits({ game, playerId: player.id })
                .elements.includes(e),
            );
          for (const c of cs)
            game.discardCovered(player.id, c, {
              reveal: true,
              skillId: "wayOfService",
            });
          hero.gainThreads(game, player, 1);
          if (same) {
            const c = yield* chooseVisibleCard(
              game,
              player.id,
              cs,
              "serviceCard",
              "选择交给目标的影",
            );
            const id = yield* game.choosePlayer(
              player.id,
              targets(game),
              "侍奉之道：交牌目标",
              { skillId: "serviceTarget" },
            );
            yield* gainCard(game, id, c, "wayOfService", options);
            hero.state.form = "shadowPrison";
          }
        },
      },
      {
        id: "shadowPrison",
        name: "禁术·影牢",
        ...this.bind("player", [Timing.SPECIAL_ACTION_END], "all"),
        filter: ({ player, context }) => context.playerId !== player.id,
        *resolve({ game, player, options }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "shadowPrison",
              "禁术·影牢：获得1糸",
            ))
          )
            return;
          hero.gainThreads(game, player, 1);
          if (
            hero.state.form &&
            hero.state.threads >= 3 &&
            (yield* game.offerSkill(
              player.id,
              "prisonRelease",
              "消耗3糸重置，伤害对手或帮助队友弃牌",
            ))
          ) {
            hero.state.threads -= 3;
            hero.state.form = null;
            const id = yield* game.choosePlayer(
              player.id,
              targets(game).filter((id) => id !== player.id),
              "禁术·影牢：选择目标",
              { skillId: "prisonTarget" },
            );
            if (game.player(id).team === player.team)
              yield* discardHand(game, id, 1, "shadowPrisonCost", options);
            else
              yield* game.damageSteps(id, 2, {
                ...options,
                sourceId: player.id,
                damageType: "spell",
                skillId: "shadowPrison",
              });
          }
        },
      },
      {
        id: "windRecord",
        name: "影之风命中登记",
        ...this.bind("actor", [Timing.ATTACK_HIT], "all"),
        filter: ({ game, context }) =>
          hero.holder(game) === context.actorId &&
          hero.isActiveAttack(context) &&
          !!context.card?.id,
        resolve({ context }) {
          hero.state.windHitCardId = context.card.id;
        },
      },
      {
        id: "windCollect",
        name: "影之风收牌",
        ...this.bind("player", [Timing.CARDS_CLEANED_UP], "all"),
        filter: ({ context }) =>
          context.cardIds.includes(hero.state.windHitCardId),
        *resolve({ game, player, options }) {
          const c = game.cards.get(hero.state.windHitCardId);
          hero.state.windHitCardId = null;
          if (c.location.zone === "discard")
            yield* hero.addShadows(game, player, [c], options);
        },
      },
      {
        id: "windThread",
        name: "影之风",
        ...this.bind("player", [Timing.ATTACK_ACTION_END], "all"),
        filter: ({ game, context }) => hero.holder(game) === context.playerId,
        resolve({ game, player }) {
          hero.gainThreads(game, player, 1);
        },
      },
      {
        id: "calmWind",
        name: "风止",
        ...this.bind("player", [Timing.TURN_END], "all"),
        filter: ({ game, context }) => hero.holder(game) === context.playerId,
        *resolve({ game, player, context, options }) {
          const p = game.player(context.playerId);
          if (
            !(yield* game.offerSkill(
              p.id,
              "calmWind",
              "风止：补满手牌，弃2牌成为女仆长的影，移除风穴",
            ))
          )
            return;
          yield* game.drawSteps(
            p.id,
            Math.max(0, p.handLimit - p.hand.length),
            { ...options, cause: { type: "directDraw", skillId: "calmWind" } },
          );
          const cs = yield* discardHand(game, p.id, 2, "calmWindCost", options);
          yield* hero.addShadows(game, player, cs, options);
          game.removeEffect(hero.state.tunnelCardId, { zone: "outside" });
        },
      },
    ];
  }
  initialize(game, p) {
    if (!this.skills.length) return;
    this.state.tunnelCardId = `windTunnel:${p.id}`;
    if (!game.effects.has("windTunnel"))
      game.registerEffect("windTunnel", {
        name: "风穴",
        category: "exclusive",
      });
    game.registerCard(
      new ExclusiveCard({ id: this.state.tunnelCardId, name: "windTunnel" }),
      { zone: "outside" },
    );
  }
  holder(g) {
    const c = g.cards.get(this.state.tunnelCardId);
    return c?.location.zone === "status" ? c.location.playerId : null;
  }
  shadows(p) {
    return coveredCards(p, "shadow");
  }
  gainThreads(g, p, n) {
    const before = this.state.threads;
    this.state.threads = Math.min(4, before + n);
    g.logSkill(
      p.id,
      "shadowPrison",
      `糸+${this.state.threads - before}（${this.state.threads}/4）`,
    );
  }
  *addShadows(g, p, cs, options) {
    g.coverCards(p.id, cs, "shadow", { sources: ["hand", "field", "discard"] });
    yield* trimCovered(g, p, "shadow", 3, "shadowOverflow");
  }
}
