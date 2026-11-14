import { Hero } from "../../hero-base.js";
import { ExclusiveCard } from "../../card.js";
import { Timing } from "../../timing.js";
import { ELEMENT_NAMES } from "../../cards.js";
import { choice, enemies, extraAction } from "../shared/actions.js";
import { coveredCards, discardHand, seatOrder } from "../shared/covered.js";
import { chooseVisibleCard, gainCard } from "../shared/compound.js";
export class Heretic extends Hero {
  constructor(enabled = true) {
    super({ id: "heretic", name: "异教徒" });
    this.state = {
      prophecyCardId: null,
      prophecyFace: null,
      revealedFace: null,
      banishUsed: false,
      banishing: false,
      damagedEnemies: [],
    };
    if (!enabled) return;
    const hero = this;
    this.skills = [
      {
        id: "hereticalDoctrine",
        name: "异端邪说",
        modifyHandLimit: (limit) =>
          hero.state.banishing
            ? 1000
            : Math.max(
                0,
                limit -
                  (hero.state.prophecyFace && !hero.state.revealedFace ? 1 : 0),
              ),
      },
      {
        id: "hereticReset",
        name: "异教徒回合重置",
        ...this.bind("player", [Timing.TURN_BEFORE], "all"),
        resolve({ player, context }) {
          hero.state.banishUsed = false;
          if (context.playerId === player.id) hero.state.damagedEnemies = [];
        },
      },
      {
        id: "calamityEnds",
        name: "灾殃止息",
        ...this.onOwnTurn([Timing.TURN_START]),
        filter: () => !!hero.state.revealedFace,
        resolve({ game, player }) {
          hero.clear(game, player);
        },
      },
      {
        id: "judgmentRecord",
        name: "审判伤害记录",
        ...this.onDamage([Timing.DAMAGE_BEFORE], "actor"),
        priority: 100,
        filter: ({ game, player, context }) =>
          game.player(context.targetId).team !== player.team,
        resolve({ context }) {
          if (!hero.state.damagedEnemies.includes(context.targetId))
            hero.state.damagedEnemies.push(context.targetId);
        },
      },
      {
        id: "heresyJudgment",
        name: "审判",
        ...this.onOwnTurn([Timing.TURN_END]),
        filter: () => hero.state.damagedEnemies.length > 0,
        *resolve({ game, player, options }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "heresyJudgment",
              "审判：我方各明弃1摸1，将弃牌交给本回合伤害过的对手",
            ))
          )
            return;
          const target = yield* game.choosePlayer(
            player.id,
            hero.state.damagedEnemies,
            "审判：交牌目标",
            { skillId: "judgmentTarget" },
          );
          const ids = seatOrder(
              game,
              player.id,
              game.players
                .filter((p) => p.team === player.team)
                .map((p) => p.id),
            ),
            discarded = [];
          for (const id of ids)
            discarded.push(
              ...(yield* discardHand(
                game,
                id,
                1,
                "judgmentDiscard",
                options,
                "public",
              )),
            );
          for (const id of ids) yield* game.drawSteps(id, 1, options);
          const available = discarded.filter(
            (c) => c.location.zone === "discard",
          );
          if (!available.length) return;
          const card = yield* chooseVisibleCard(
            game,
            player.id,
            available,
            "judgmentCard",
            "选择交给对手的弃牌",
          );
          yield* gainCard(game, target, card, "heresyJudgment", options);
          if (hero.active(game))
            hero.addProphecies(
              game,
              player,
              available.filter(
                (c) => c !== card && c.location.zone === "discard",
              ),
            );
        },
      },
      {
        id: "sacrifice",
        name: "献祭",
        ...this.onOwnTurn([Timing.ACTIVATION]),
        activationEnablesAction: () => true,
        filter: ({ game, player }) =>
          hero.active(game) && hero.prophecies(player).length > 0,
        *resolve({ game, player, options }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "sacrifice",
              "献祭：猜测预言顶牌系别",
            ))
          )
            return;
          const element = yield* choice(
            player.id,
            "sacrificeElement",
            "指定预言系别",
            Object.entries(ELEMENT_NAMES).map(([value, label]) => ({
              value,
              label,
            })),
          );
          const c = hero.prophecies(player).at(-1);
          game.logSkill(
            player.id,
            "sacrifice",
            `指定${ELEMENT_NAMES[element]}，展示${game.describeCards([c], player.id)}`,
          );
          game.recordPublicAction({
            type: "prophecyReveal",
            playerId: player.id,
            card: c.name,
            ...c.getTraits({ game, playerId: player.id }),
          });
          if (
            c
              .getTraits({ game, playerId: player.id })
              .elements.includes(element)
          ) {
            game.discardCovered(player.id, c, {
              reveal: true,
              skillId: "sacrifice",
            });
            game.addStones(player.team, "gem");
          } else {
            const replacement = game.takeDeckCard();
            if (replacement)
              hero.addProphecies(game, player, [replacement], {
                replace: true,
              });
            game.moveCard(c.id, { zone: "hand", playerId: player.id });
            yield* game.drawSteps(player.id, 0, options);
          }
          yield* hero.flipIfEmpty(game, player, options);
        },
      },
      {
        id: "banishment",
        name: "放逐",
        action: () =>
          !hero.state.banishUsed
            ? { type: "spell", energy: "crystal", targetCount: 0 }
            : null,
        *resolveAction({ game, player, options }) {
          hero.state.banishUsed = true;
          yield* game.paySkillEnergy(player.id, "crystal");
          const n = yield* choice(
            player.id,
            "banishmentDraw",
            "放逐：无视手牌上限摸牌",
            [
              { value: 6, label: "摸6张牌" },
              { value: 7, label: "摸7张牌" },
            ],
          );
          hero.state.banishing = true;
          try {
            yield* game.drawSteps(player.id, n, options);
            for (const p of game.players)
              if (p.hero.id === "heretic" && p.hero.active(game))
                p.hero.clear(game, p);
            hero.clear(game, player);
            hero.state.prophecyFace = yield* choice(
              player.id,
              "prophecyFace",
              "选择末日预言背面",
              [
                { value: "thunderFire", label: "天雷劫火" },
                { value: "earthWater", label: "地裂波涛" },
              ],
            );
            game.moveCard(hero.state.prophecyCardId, { zone: "field" });
            const cs = yield* game.chooseHandCards(
              player.id,
              6,
              (c) => c.category === "basic",
              {
                skillId: "prophecyCards",
                purpose: "reserve",
                title: "选择6张基础牌洗混作为预言",
              },
            );
            hero.addProphecies(game, player, cs);
            yield* extraAction(game, player, "banishmentAction");
          } finally {
            hero.state.banishing = false;
          }
          yield* game.drawSteps(player.id, 0, options);
        },
      },
      {
        id: "doomDraw",
        name: "末日预言",
        ...this.bind("player", [Timing.DRAW_BEFORE], "all"),
        priority: -100,
        filter: ({ game, player, context }) =>
          hero.active(game) &&
          context.cause.type === "damage" &&
          context.count > 0 &&
          !context.replacementCards?.length &&
          hero.prophecies(player).length > 0,
        resolve({ game, player, context }) {
          context.replacementCards = [hero.prophecies(player).at(-1)];
          if (hero.prophecies(player).length === 1)
            hero.pendingFlipContext = context.damageContext;
          game.logSkill(
            player.id,
            "doomDraw",
            `替代${game.actorLabel(context.playerId)}的第1张伤害摸牌`,
          );
        },
      },
      {
        id: "doomFlip",
        name: "末日预言翻面",
        ...this.bind("target", [Timing.DAMAGE_AFTER], "all"),
        priority: -100,
        filter: ({ game, player, context }) =>
          hero.active(game) &&
          hero.prophecies(player).length === 0 &&
          (!hero.pendingFlipContext || hero.pendingFlipContext === context),
        *resolve({ game, player, options }) {
          yield* hero.flipIfEmpty(game, player, options);
        },
      },
      { id: "greed", name: "贪婪" },
    ];
  }
  initialize(g, p) {
    if (!this.skills.length) return;
    this.state.prophecyCardId = `doomProphecy:${p.id}`;
    g.registerCard(
      new ExclusiveCard({
        id: this.state.prophecyCardId,
        name: "doomProphecy",
        heroId: p.id,
      }),
      { zone: "outside" },
    );
    g.gainEnergy(p.id, "crystal");
  }
  active(g) {
    return (
      !!this.state.prophecyFace &&
      !this.state.revealedFace &&
      g.cards.get(this.state.prophecyCardId)?.location.zone === "field"
    );
  }
  prophecies(p) {
    return coveredCards(p, "prophecy");
  }
  clear(g, p) {
    this.pendingFlipContext = null;
    for (const c of [...this.prophecies(p)])
      g.discardCovered(p.id, c, { skillId: "doomDraw" });
    const card = g.cards.get(this.state.prophecyCardId);
    if (card) {
      g.moveCard(card.id, { zone: "outside" });
      card.name = "doomProphecy";
    }
    this.state.prophecyFace = null;
    this.state.revealedFace = null;
  }
  addProphecies(g, p, cards, { replace = false } = {}) {
    const shuffled = [...cards];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(g.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const space = Math.max(
      0,
      6 - this.prophecies(p).length + (replace ? 1 : 0),
    );
    for (const c of shuffled.slice(0, space)) {
      g.coverCards(p.id, [c], "prophecy", {
        sources: ["hand", "discard", "deck"],
      });
      c.coveredVisibility = "concealed";
    }
  }
  *flipIfEmpty(g, p, options) {
    if (!this.active(g) || this.prophecies(p).length) return;
    this.pendingFlipContext = null;
    const face = this.state.prophecyFace;
    this.state.revealedFace = face;
    const card = g.cards.get(this.state.prophecyCardId);
    card.name =
      face === "thunderFire" ? "thunderCatastrophe" : "earthCatastrophe";
    g.logSkill(
      p.id,
      "doomFlip",
      `展示${face === "thunderFire" ? "天雷劫火" : "地裂波涛"}`,
    );
    const elements =
      face === "thunderFire" ? ["thunder", "fire"] : ["earth", "water"];
    let both = false;
    if (
      g.canPayEnergy(p.id, "crystal") &&
      (yield* g.offerSkill(p.id, "greed", "贪婪：水晶，两项依次发动"))
    ) {
      yield* g.paySkillEnergy(p.id, "crystal");
      both = true;
    }
    const first = yield* choice(
      p.id,
      "calamityOrder",
      both ? "选择先发动的系别" : "选择发动的系别",
      elements.map((value) => ({ value, label: ELEMENT_NAMES[value] })),
    );
    for (const element of both
      ? [first, ...elements.filter((e) => e !== first)]
      : [first]) {
      const max = Math.min(
        4,
        p.hand.filter((c) =>
          c.getTraits({ game: g, playerId: p.id }).elements.includes(element),
        ).length,
      );
      const cs = yield* g.chooseCardSet(p.id, {
        counts: Array.from({ length: max + 1 }, (_, i) => i),
        cardsFilter: (cards) =>
          cards.every((c) =>
            c.getTraits({ game: g, playerId: p.id }).elements.includes(element),
          ),
        skillId: "calamityCost",
        title: `明弃0至${max}张${ELEMENT_NAMES[element]}系牌`,
      });
      if (cs.length) {
        g.discardCards(p.id, cs, { reason: "calamityCost" });
        yield* g.flushRuleEvents(options);
        yield* g.drawSteps(p.id, cs.length, options);
      }
      const id = yield* g.choosePlayer(
        p.id,
        enemies(g, p),
        "灾殃：法术伤害目标",
        { skillId: "calamityTarget", context: { amount: cs.length + 1 } },
      );
      const enemy = g.player(id),
        count = enemy.hand.filter((c) =>
          c.getTraits({ game: g, playerId: id }).elements.includes(element),
        ).length;
      const discard = yield* g.chooseCardSet(id, {
        counts: Array.from({ length: count + 1 }, (_, i) => i),
        cardsFilter: (cards) =>
          cards.every((c) =>
            c.getTraits({ game: g, playerId: id }).elements.includes(element),
          ),
        skillId: "calamityDefense",
        title: "可明弃同系牌后承受法术伤害",
      });
      if (discard.length) {
        g.discardCards(id, discard, { reason: "calamityDefense" });
        yield* g.flushRuleEvents(options);
      }
      yield* g.damageSteps(id, cs.length + 1, {
        ...options,
        sourceId: p.id,
        damageType: "spell",
        skillId: "doomFlip",
      });
    }
  }
}
