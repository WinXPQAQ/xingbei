import { Hero } from "../../hero-base.js";
import { ExclusiveCard, AttackCard } from "../../card.js";
import { Timing } from "../../timing.js";
import { playableCards } from "../../playable-cards.js";
import { choice, targets } from "../shared/actions.js";
import {
  coveredCards,
  discardHand,
  trimCovered,
  seatOrder,
} from "../shared/covered.js";
import { chooseVisibleCard, insertedAction } from "../shared/compound.js";
import { selectCovered, selectPlayers } from "../shared/selection.js";
export class ChronicleCard extends ExclusiveCard {
  constructor(id) {
    super({ id, name: "chronicle", elements: ["earth"], fates: ["H"] });
    this.type = "attack";
    this.publicIdentity = true;
  }
  legalTargets(c) {
    return AttackCard.prototype.legalTargets.call(this, c);
  }
  canRespond(c, ctx) {
    return AttackCard.prototype.canRespond.call(this, c, ctx);
  }
  resolve(c) {
    return AttackCard.prototype.resolve.call(this, c);
  }
  destinationForMove(to) {
    return this.location.zone === "hand" &&
      !(to.zone === "hand" && to.playerId === this.location.playerId)
      ? { zone: "outside" }
      : to;
  }
}
export class Chronicler extends Hero {
  constructor(enabled = true) {
    super({ id: "chronicler", name: "记录者" });
    this.state = {
      archives: 0,
      ruinRebuttalUsed: false,
      bookCardId: null,
      castingCardId: null,
    };
    if (!enabled) return;
    const hero = this;
    this.skills = [
      {
        id: "ruinReset",
        name: "遗迹论破重置",
        ...this.bind("player", [Timing.TURN_BEFORE], "all"),
        resolve() {
          hero.state.ruinRebuttalUsed = false;
        },
      },
      {
        id: "unityOfKnowledge",
        name: "知行合一",
        action: () => ({ type: "spell", targetCount: 0 }),
        *resolveAction({ game, player, options }) {
          const shown = hero.revealTop(game, player, 2, "study");
          const usable = shown.filter(
            (c) =>
              game.allowsAction(player.id, c.type) &&
              game.allowsCard(player.id, c) &&
              c
                .legalTargets({ game, actor: player })
                .some(
                  (id) =>
                    c.type !== "attack" || game.canAttackTarget(player.id, id),
                ),
          );
          const c = yield* chooseVisibleCard(
            game,
            player.id,
            usable,
            "studyCard",
            "知行合一：选择一张立即使用，或放弃",
            true,
          );
          if (c) {
            yield* discardHand(game, player.id, 1, "studyCost", options);
            const ids = c
              .legalTargets({ game, actor: player })
              .filter(
                (id) =>
                  c.type !== "attack" || game.canAttackTarget(player.id, id),
              );
            const id = yield* game.choosePlayer(
              player.id,
              ids,
              "知行合一目标",
              { skillId: "studyTarget", context: { card: c } },
            );
            hero.state.castingCardId = c.id;
            try {
              yield* insertedAction(
                game,
                player.id,
                "unityOfKnowledge",
                function* () {
                  yield* game.actionSteps(
                    player.id,
                    playableCards(player).indexOf(c),
                    id,
                    options,
                  );
                },
              );
            } finally {
              hero.state.castingCardId = null;
            }
          }
          const remaining = shown.filter(
            (x) => x !== c && x.location.zone === "covered",
          );
          for (const x of remaining)
            game.discardCovered(player.id, x, {
              reveal: true,
              skillId: "unityOfKnowledge",
            });
          yield* hero.gainArchives(game, player, remaining.length, options);
        },
      },
      {
        id: "ruinRebuttal",
        name: "遗迹论破",
        ...this.onOwnAttack([Timing.ATTACK_DECLARED]),
        filter: ({ context }) =>
          hero.isActiveAttack(context) && !hero.state.ruinRebuttalUsed,
        *resolve({ game, player, context }) {
          const predicate = (c) =>
            c
              .getTraits({ game, playerId: player.id })
              .elements.some((e) =>
                ["light", "dark", ...context.attackTraits.elements].includes(e),
              );
          const cs = yield* selectCovered(game, player, "ruins", {
            skillId: "ruinRebuttal",
            min: 1,
            max: 8,
            optional: true,
            predicate,
          });
          if (!cs.length) return;
          hero.state.ruinRebuttalUsed = true;
          for (const c of cs)
            game.discardCovered(player.id, c, {
              reveal: true,
              skillId: "ruinRebuttal",
            });
          context.amount += cs.length - 1;
          game.logSkill(
            player.id,
            "ruinRebuttal",
            `移除${cs.length}遗迹，本次攻击伤害+${cs.length - 1}`,
          );
          if (cs.length > 1)
            game.turn.addAction({
              type: "spell",
              sourceSkillId: "ruinRebuttal",
            });
          if (!hero.ruins(player).length) game.addStones(player.team, "gem");
        },
      },
      {
        id: "historicalCompilation",
        name: "引稽编鉴",
        ...this.bind("actor", [Timing.ATTACK_DECLARED], "all"),
        filter: ({ context }) =>
          hero.isActiveAttack(context) &&
          context.card?.id === hero.state.bookCardId,
        *resolve({ game, context, options }) {
          const actor = game.player(context.actorId),
            target = game.player(context.targetId);
          if (
            !(yield* game.offerSkill(
              actor.id,
              "historicalCompilation",
              "引稽编鉴：对手交1牌入遗迹，可交换至多2牌",
            ))
          )
            return;
          if (target.hand.length) {
            const cs = yield* game.chooseHandCards(target.id, 1, () => true, {
              skillId: "compilationCost",
            });
            yield* hero.addRuins(game, actor, cs, options);
          }
          yield* hero.exchange(game, actor, 2, true, options);
        },
      },
      {
        id: "myriadRuins",
        name: "秘境万象",
        action: (g, p) =>
          g.cards.get(hero.state.bookCardId)?.location.zone === "hand" &&
          g.cards.get(hero.state.bookCardId).location.playerId === p.id
            ? { type: "spell", targetCount: 0 }
            : null,
        *resolveAction({ game, player, options }) {
          game.moveCard(hero.state.bookCardId, { zone: "outside" });
          for (const c of [...hero.ruins(player)])
            game.discardCovered(player.id, c, {
              reveal: true,
              skillId: "myriadRuins",
            });
          const seen = new Set(),
            shown = [];
          while (shown.length < 8) {
            const [c] = hero.revealTop(game, player, 1, "ruins");
            if (!c) break;
            shown.push(c);
            const es = c.getTraits({ game, playerId: player.id }).elements;
            if (es.some((e) => seen.has(e))) break;
            es.forEach((e) => seen.add(e));
          }
          if (shown.length > 3) {
            const ids = yield* selectPlayers(
              game,
              player,
              targets(game),
              Math.min(6, shown.length - 3),
              "myriadTargets",
              "秘境万象：2法伤目标",
            );
            for (const id of seatOrder(game, player.id, ids))
              yield* game.damageSteps(id, 2, {
                ...options,
                sourceId: player.id,
                damageType: "spell",
                skillId: "myriadRuins",
              });
          }
        },
      },
      {
        id: "pastPresent",
        name: "古今互鉴",
        ...this.onOwnTurn([Timing.ACTIVATION]),
        filter: ({ game, player }) => game.canPayEnergy(player.id, "crystal"),
        *resolve({ game, player, options }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "pastPresent",
              "古今互鉴：水晶，史料+2，可用2手牌交换遗迹",
            ))
          )
            return;
          yield* game.paySkillEnergy(player.id, "crystal");
          yield* hero.gainArchives(game, player, 2, options);
          if (player.hand.length >= 2)
            yield* hero.exchange(game, player, 2, false, options);
        },
      },
      { id: "legendaryLand", name: "传说之地" },
      { id: "ancientLore", name: "稽古识典" },
      { id: "refinedSelection", name: "选淬精炼" },
    ];
  }
  initialize(g, p) {
    if (!this.skills.length) return;
    this.state.bookCardId = `chronicle:${p.id}`;
    g.registerCard(new ChronicleCard(this.state.bookCardId), {
      zone: "outside",
    });
    this.revealTop(g, p, 3, "ruins");
  }
  ruins(p) {
    return coveredCards(p, "ruins");
  }
  revealTop(g, p, count, pile) {
    const cards = [];
    for (let i = 0; i < count; i++) {
      const c = g.takeDeckCard();
      if (!c) break;
      g.coverCards(p.id, [c], pile, { sources: ["deck"], reveal: true });
      cards.push(c);
    }
    return cards;
  }
  *addRuins(g, p, cards, options) {
    for (const c of cards) {
      if (c.location.zone === "hand" && c.location.playerId !== p.id) {
        g.queueExposure(c.location.playerId, [c], { reason: "ruins" });
        g.moveCard(c.id, { zone: "field" });
      }
      g.coverCards(p.id, [c], "ruins", {
        sources: ["hand", "field", "discard"],
        reveal: true,
      });
    }
    yield* g.flushRuleEvents(options);
    yield* trimCovered(g, p, "ruins", 8, "ruinOverflow");
  }
  *gainArchives(g, p, n, options) {
    this.state.archives = Math.min(3, this.state.archives + n);
    g.logSkill(p.id, "ancientLore", `史料变为${this.state.archives}/3`);
    if (this.state.archives < 3) return;
    this.state.archives = 0;
    yield* discardHand(g, p.id, 1, "ancientLoreCost", options);
    const book = g.cards.get(this.state.bookCardId);
    if (book.location.zone === "outside") {
      g.moveCard(book.id, { zone: "hand", playerId: p.id });
      g.logSkill(p.id, "ancientLore", "史料清空，获得史书");
      yield* g.drawSteps(p.id, 0, options);
    }
  }
  *exchange(g, p, max, equal, options) {
    if (!p.hand.length || !this.ruins(p).length) return;
    const counts = equal
      ? Array.from(
          { length: Math.min(max, p.hand.length, this.ruins(p).length) },
          (_, i) => i + 1,
        )
      : [2];
    const hand = yield* g.chooseCardSet(p.id, {
      counts,
      skillId: "archiveExchangeHand",
      optional: true,
      title: "选择交换到遗迹的手牌",
    });
    if (!hand) return;
    const ruins = yield* selectCovered(g, p, "ruins", {
      skillId: "archiveExchangeRuins",
      min: equal ? hand.length : 1,
      max: equal ? hand.length : this.ruins(p).length,
    });
    for (const c of ruins) g.moveCard(c.id, { zone: "hand", playerId: p.id });
    yield* this.addRuins(g, p, hand, options);
    yield* g.drawSteps(p.id, 0, options);
  }
}
