import { Hero } from "../../hero-base.js";
import { ExclusiveCard } from "../../card.js";
import { Timing } from "../../timing.js";
import { targets, enemies, spendStones } from "../shared/actions.js";
import { coveredCards, discardHand } from "../shared/covered.js";
import { chooseVisibleCard, gainCard } from "../shared/compound.js";
export class BarrierMaster extends Hero {
  constructor(enabled = true) {
    super({ id: "barrierMaster", name: "结界师" });
    this.state = { ritual: 0, form: null, realmCardId: null };
    if (!enabled) return;
    const hero = this;
    this.skills = [
      {
        id: "barrierRitual",
        name: "结界仪式",
        action: (g, p) =>
          hero.barriers(p).length
            ? null
            : { type: "spell", cardCount: 2, targetCount: 0 },
        *resolveAction({ game, player, cards, options }) {
          game.coverCards(player.id, cards, "barrier", { reveal: true });
          yield* game.flushRuleEvents(options);
          yield* hero.gainRitual(game, player, 1, options);
        },
      },
      {
        id: "wildGodPower",
        name: "荒神之力",
        ...this.bind("actor", [Timing.ATTACK_HIT], "all"),
        filter: ({ game, player, context }) =>
          hero.matches(game, player, context),
        resolve({ game, player, context }) {
          context.amount++;
          game.logSkill(
            player.id,
            "wildGodPower",
            "攻击与结界同系，本次攻击伤害+1",
          );
        },
      },
      {
        id: "wildGodRite",
        name: "荒神祭仪",
        ...this.bind("actor", [Timing.ATTACK_DECLARED], "all"),
        filter: ({ game, player, context }) =>
          hero.isActiveAttack(context) && hero.matches(game, player, context),
        *resolve({ game, player, options }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "wildGodRite",
              "荒神祭仪：祭+1，可消耗3祭移除结界并横置",
            ))
          )
            return;
          yield* hero.gainRitual(game, player, 1, options);
          if (
            hero.state.ritual >= 3 &&
            hero.barriers(player).length &&
            (yield* game.offerSkill(
              player.id,
              "riteRelease",
              "移除3祭、弃1牌并移除1结界，横置",
            ))
          ) {
            hero.state.ritual -= 3;
            yield* discardHand(game, player.id, 1, "wildGodRiteCost", options);
            yield* hero.removeBarrier(game, player);
            hero.state.form = "glassRealm";
          }
        },
      },
      {
        id: "forbiddenRealm",
        name: "禁魔境",
        action: (g) =>
          hero.state.ritual > 0 ? { type: "spell", targets: targets(g) } : null,
        *resolveAction({ game, player, targetIds, options }) {
          hero.state.ritual--;
          game.attachCard(hero.state.realmCardId, targetIds[0], {
            effectId: "absoluteRealm",
            sourcePlayerId: player.id,
          });
          yield* discardHand(game, player.id, 1, "forbiddenRealm", options);
          hero.collapse(game, player);
        },
      },
      {
        id: "glassRealm",
        name: "琉璃境",
        ...this.bind("team", [Timing.MORALE_AFTER], "self"),
        filter: ({ context }) => hero.state.form && context.amount < 0,
        *resolve({ game, player, options }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "glassRealm",
              "琉璃境：重置、战绩宝石+1，目标明弃1牌",
            ))
          )
            return;
          hero.state.form = null;
          const n = game.addStones(player.team, "gem");
          game.logSkill(player.id, "glassRealm", `重置，战绩宝石+${n}`);
          const id = yield* game.choosePlayer(
            player.id,
            targets(game),
            "琉璃境：弃牌目标",
            { skillId: "glassTarget" },
          );
          const [c] = yield* discardHand(
            game,
            id,
            1,
            "glassDiscard",
            options,
            "public",
          );
          if (
            c &&
            c.location.zone === "discard" &&
            hero.barriers(player).length < 2 &&
            (yield* game.offerSkill(player.id, "glassKeep", "将弃牌作为结界"))
          )
            game.coverCards(player.id, [c], "barrier", {
              sources: ["discard"],
              reveal: true,
            });
        },
      },
      {
        id: "realmDecay",
        name: "灭界破散",
        ...this.bind("player", [Timing.TURN_END], "all"),
        priority: 100,
        filter: ({ game, context }) => hero.holder(game) === context.playerId,
        *resolve({ game, player }) {
          yield* hero.removeBarrier(game, player);
        },
      },
      {
        id: "whiteKarma",
        name: "白二羯磨",
        ...this.bind("player", [Timing.ATTACK_ACTION_END], "all"),
        filter: ({ game, context }) => hero.holder(game) === context.playerId,
        *resolve({ game, player, context, options }) {
          const id = context.playerId;
          if (
            !(yield* game.offerSkill(
              id,
              "whiteKarma",
              "白二羯磨：结界师+1祭，你获得1结界",
            ))
          )
            return;
          yield* hero.gainRitual(game, player, 1, options);
          const cs = hero.barriers(player);
          if (cs.length) {
            const c = yield* chooseVisibleCard(
              game,
              id,
              cs,
              "karmaCard",
              "选择加入手牌的结界",
            );
            yield* gainCard(game, id, c, "whiteKarma", options);
            hero.collapse(game, player);
          }
        },
      },
      { id: "banishingRealm", name: "伏魔境" },
    ];
  }
  initialize(g, p) {
    if (!this.skills.length) return;
    this.state.realmCardId = `absoluteRealm:${p.id}`;
    if (!g.effects.has("absoluteRealm"))
      g.registerEffect("absoluteRealm", {
        name: "绝界",
        category: "exclusive",
      });
    g.registerCard(
      new ExclusiveCard({ id: this.state.realmCardId, name: "absoluteRealm" }),
      { zone: "outside" },
    );
  }
  barriers(p) {
    return coveredCards(p, "barrier");
  }
  holder(g) {
    const c = g.cards.get(this.state.realmCardId);
    return c?.location.zone === "status" ? c.location.playerId : null;
  }
  blocksBasicEffects({ game, targetId }) {
    return this.holder(game) === targetId;
  }
  matches(g, p, ctx) {
    return this.barriers(p).some((c) =>
      c
        .getTraits({ game: g, playerId: p.id })
        .elements.some((e) => ctx.attackTraits.elements.includes(e)),
    );
  }
  collapse(g, p) {
    if (this.holder(g) != null && !this.barriers(p).length) {
      this.state.form = "glassRealm";
      g.removeEffect(this.state.realmCardId, { zone: "outside" });
      g.logSkill(p.id, "realmDecay", "结界耗尽，横置并移除绝界");
    }
  }
  *removeBarrier(g, p) {
    if (this.barriers(p).length) {
      const c = yield* g.chooseCoveredCard(p.id, "barrier", {
        skillId: "removeBarrier",
        title: "移除1结界",
      });
      g.discardCovered(p.id, c, { reveal: true, skillId: "realmDecay" });
    }
    this.collapse(g, p);
  }
  *gainRitual(g, p, n, options) {
    const before = this.state.ritual;
    this.state.ritual = Math.min(3, before + n);
    g.logSkill(
      p.id,
      "wildGodRite",
      `祭+${this.state.ritual - before}（${this.state.ritual}/3）`,
    );
    if (
      this.state.ritual === before ||
      !g.canPayEnergy(p.id, "crystal") ||
      !(yield* g.offerSkill(p.id, "banishingRealm", "伏魔境：水晶，对手1法伤"))
    )
      return;
    yield* g.paySkillEnergy(p.id, "crystal");
    const id = yield* g.choosePlayer(p.id, enemies(g, p), "伏魔境：选择对手", {
      skillId: "banishingTarget",
    });
    const morale = g.teams[g.player(id).team].morale;
    yield* g.damageSteps(id, 1, {
      ...options,
      sourceId: p.id,
      damageType: "spell",
      skillId: "banishingRealm",
    });
    if (
      g.teams[g.player(id).team].morale < morale &&
      g.stoneCounts(p.team).total
    ) {
      yield* spendStones(g, p, "banishingStone", 1);
      g.gainEnergy(p.id, "crystal");
    }
  }
}
