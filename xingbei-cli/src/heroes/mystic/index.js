import { Hero } from "../../hero-base.js";
import { Timing } from "../../timing.js";
import { playableCards } from "../../playable-cards.js";
import { choice, targets, enemies, discardCost } from "../shared/actions.js";
import {
  coveredCards,
  trimCovered,
  discardHand,
  seatOrder,
} from "../shared/covered.js";
import { selectPlayers } from "../shared/selection.js";
import { chooseVisibleCard, insertedAction } from "../shared/compound.js";
export class Mystic extends Hero {
  constructor(enabled = true) {
    super({ id: "mystic", name: "神秘学者" });
    this.state = { sorcery: 0, fairyUsed: false, castingWordId: null };
    if (!enabled) return;
    const hero = this;
    this.skills = [
      {
        id: "mysticReset",
        name: "妖精秘术重置",
        ...this.bind("player", [Timing.TURN_BEFORE], "all"),
        resolve() {
          hero.state.fairyUsed = false;
        },
      },
      {
        id: "wordSpirit",
        name: "言灵术",
        action: () => ({ type: "spell", cardCounts: [1, 2], targetCount: 0 }),
        *resolveAction({ game, player, cards, options }) {
          yield* hero.addWords(game, player, cards, options);
          yield* game.drawSteps(player.id, 1, {
            ...options,
            cause: { type: "directDraw", skillId: "wordSpirit" },
          });
          const predicate = (c) =>
            hero
              .words(player)
              .some((w) =>
                w
                  .getTraits({ game, playerId: player.id })
                  .elements.some((e) =>
                    c
                      .getTraits({ game, playerId: player.id })
                      .elements.includes(e),
                  ),
              );
          if (player.hand.some(predicate)) {
            const cs = yield* game.chooseHandCards(player.id, 1, predicate, {
              skillId: "wordSpiritCost",
              optional: true,
              title: "额外明弃1同系牌获得秘术",
            });
            if (cs) {
              yield* discardCost(game, player, cs, "wordSpirit", options);
              hero.gainSorcery(game, player, 1);
            }
          }
        },
      },
      {
        id: "guardianSpirit",
        name: "守护灵",
        ...this.bind("target", [Timing.ATTACK_HIT], "self"),
        priority: 100,
        filter: ({ player, context }) =>
          hero.isActiveAttack(context) && hero.words(player).length > 0,
        *resolve({ game, player, options }) {
          const c = yield* game.chooseCoveredCard(player.id, "word", {
            skillId: "guardianSpirit",
            title: "守护灵：移除1言灵",
          });
          game.discardCovered(player.id, c, {
            reveal: true,
            skillId: "guardianSpirit",
          });
          if (hero.state.sorcery > 0) {
            hero.state.sorcery--;
            if (player.hand.length) {
              const cs = yield* game.chooseHandCards(player.id, 1, () => true, {
                skillId: "guardianWord",
              });
              yield* hero.addWords(game, player, cs, options);
            }
          }
        },
      },
      {
        id: "trueWord",
        name: "真言术",
        action: (game, player) =>
          hero.usableWords(game, player).length
            ? { type: "spell", targetCount: 0 }
            : null,
        *resolveAction({ game, player, options }) {
          yield* hero.wordChain(game, player, options);
        },
      },
      {
        id: "forbiddenMystery",
        name: "禁忌秘法",
        ...this.onOwnTurn([Timing.TURN_BEFORE]),
        priority: 10,
        filter: () => hero.state.sorcery >= 3,
        *resolve({ game, player, options }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "forbiddenMystery",
              "禁忌秘法：3秘术，两名角色各弃1牌成为言灵",
            ))
          )
            return;
          hero.state.sorcery -= 3;
          const ids = yield* selectPlayers(
            game,
            player,
            targets(game),
            2,
            "forbiddenTargets",
            "选择两名角色",
          );
          for (const id of seatOrder(game, player.id, ids)) {
            const cs = yield* discardHand(
              game,
              id,
              1,
              "forbiddenMysteryCost",
              options,
            );
            if (cs.length) yield* hero.addWords(game, player, cs, options);
          }
        },
      },
      {
        id: "fairyMystery",
        name: "妖精秘术",
        ...this.onOwnAttack([Timing.ATTACK_HIT]),
        filter: ({ context }) =>
          hero.isActiveAttack(context) &&
          context.actionSourceSkillId === "fairyMystery",
        resolve({ game, player }) {
          hero.gainSorcery(game, player, 2);
        },
      },
      { id: "wordSuppression", name: "真言压制" },
    ];
  }
  words(p) {
    return coveredCards(p, "word");
  }
  usableWords(g, p) {
    return this.words(p).filter(
      (c) =>
        !c.getTraits({ game: g, playerId: p.id }).elements.includes("light") &&
        g.allowsCard(p.id, c) &&
        g.allowsAction(p.id, c.type) &&
        c
          .legalTargets({ game: g, actor: p })
          .some((id) => c.type !== "attack" || g.canAttackTarget(p.id, id)),
    );
  }
  gainSorcery(g, p, n) {
    const before = this.state.sorcery;
    this.state.sorcery = Math.min(4, before + n);
    g.logSkill(
      p.id,
      "wordSpirit",
      `秘术+${this.state.sorcery - before}（${this.state.sorcery}/4）`,
    );
  }
  *addWords(g, p, cs, options) {
    g.coverCards(p.id, cs, "word", {
      sources: ["hand", "discard"],
      reveal: true,
    });
    yield* g.flushRuleEvents(options);
    yield* trimCovered(g, p, "word", 3, "wordOverflow");
  }
  *wordChain(g, p, options) {
    // Only this generator owns the continuation window. Declining or choosing
    // fairyMystery returns immediately; no continuation enters pendingActions.
    let stage = "word";
    while (!g.winner) {
      if (stage === "word") {
        const usable = this.usableWords(g, p);
        if (!usable.length) return;
        const c = yield* chooseVisibleCard(
          g,
          p.id,
          usable,
          "trueWordCard",
          "真言术：选择言灵",
        );
        const ids = c
          .legalTargets({ game: g, actor: p })
          .filter((id) => c.type !== "attack" || g.canAttackTarget(p.id, id));
        const id = yield* g.choosePlayer(p.id, ids, "真言术：选择用牌目标", {
          skillId: "trueWordTarget",
          context: { card: c },
        });
        const free =
          c.type === "spell" ||
          c.getTraits({ game: g, playerId: p.id }).fates.includes("Y");
        this.state.castingWordId = c.id;
        try {
          yield* insertedAction(
            g,
            p.id,
            "trueWord",
            function* () {
              yield* g.actionSteps(
                p.id,
                playableCards(p).indexOf(c),
                id,
                options,
              );
            },
            options,
          );
        } finally {
          this.state.castingWordId = null;
        }
        if (
          free ||
          (this.state.sorcery > 0 &&
            (yield* g.offerSkill(p.id, "wordExtra", "移除1秘术，追加1法伤")))
        ) {
          if (!free) this.state.sorcery--;
          const target = yield* g.choosePlayer(
            p.id,
            enemies(g, p),
            "真言术：追加法伤",
            { skillId: "wordDamageTarget" },
          );
          yield* g.damageSteps(target, 1, {
            ...options,
            sourceId: p.id,
            damageType: "spell",
            skillId: "trueWord",
          });
        }
      } else {
        yield* g.paySkillEnergy(p.id, "crystal");
        const target = yield* g.choosePlayer(
          p.id,
          targets(g),
          "真言压制：1法伤目标",
          { skillId: "suppressionTarget" },
        );
        yield* g.damageSteps(target, 1, {
          ...options,
          sourceId: p.id,
          damageType: "spell",
          skillId: "wordSuppression",
        });
      }
      const choices = [{ value: "end", label: "结束技能链" }];
      if (stage === "word" && g.canPayEnergy(p.id, "crystal"))
        choices.push({ value: "suppress", label: "立即发动真言压制（1水晶）" });
      if (stage === "suppress" && this.usableWords(g, p).length)
        choices.push({ value: "word", label: "立即发动真言术" });
      if (
        !this.state.fairyUsed &&
        g.allowsAction(p.id, "attack") &&
        enemies(g, p).some((id) => g.canAttackTarget(p.id, id)) &&
        p.hand.some((c) => c.type === "attack" && g.allowsCard(p.id, c))
      )
        choices.push({
          value: "fairy",
          label: "立即发动妖精秘术（攻击后结束此链）",
        });
      if (choices.length === 1) return;
      const next = yield* choice(
        p.id,
        "mysticContinuation",
        "选择立即续接，放弃后不能保留",
        choices,
        "end",
        { stage },
      );
      if (next === "end") return;
      if (next === "fairy") {
        this.state.fairyUsed = true;
        const [c] = yield* g.chooseHandCards(
          p.id,
          1,
          (c) => c.type === "attack" && g.allowsCard(p.id, c),
          { skillId: "fairyAttackCard", purpose: "attack" },
        );
        const target = yield* g.choosePlayer(
          p.id,
          enemies(g, p).filter((id) => g.canAttackTarget(p.id, id)),
          "妖精秘术：立即攻击目标",
          { skillId: "fairyAttackTarget" },
        );
        yield* insertedAction(
          g,
          p.id,
          "fairyMystery",
          function* () {
            yield* g.actionSteps(p.id, p.hand.indexOf(c), target, options);
          },
          options,
        );
        return;
      }
      stage = next;
    }
  }
}
