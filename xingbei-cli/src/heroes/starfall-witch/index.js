import { Hero } from "../../hero-base.js";
import { ExclusiveCard } from "../../card.js";
import { Timing } from "../../timing.js";
import { choice, targets, enemies, discardCost } from "../shared/actions.js";
import { coveredCards, trimCovered, seatOrder } from "../shared/covered.js";
import { selectCovered, selectPlayers } from "../shared/selection.js";
const LAWS = { starlight: "繁星", moonlight: "影月", eclipse: "蚀日" };
export function runePattern(game, player, cards) {
  const elements = {},
    fates = {};
  for (const c of cards) {
    const t = c.getTraits({ game, playerId: player.id });
    for (const e of t.elements) elements[e] = (elements[e] ?? 0) + 1;
    for (const f of t.fates) fates[f] = (fates[f] ?? 0) + 1;
  }
  const groups = (values, n) =>
    Object.values(values).reduce((sum, v) => sum + Math.floor(v / n), 0);
  return {
    elements: Object.keys(elements).length,
    fates: Object.keys(fates).length,
    elementPairs: groups(elements, 2),
    fatePairs: groups(fates, 2),
    elementTriples: groups(elements, 3),
    fateTriples: groups(fates, 3),
  };
}
export class StarfallWitch extends Hero {
  constructor(enabled = true) {
    super({ id: "starfallWitch", name: "星坠女巫" });
    this.state = {
      starlight: true,
      moonlight: false,
      eclipse: false,
      starRingUsed: false,
    };
    if (!enabled) return;
    const hero = this;
    this.skills = [
      {
        id: "destinedLaw",
        name: "命定之理",
        modifyHandLimit: () => 7 - hero.laws().length,
      },
      {
        id: "starRingReset",
        name: "星环重置",
        ...this.bind("player", [Timing.TURN_BEFORE], "all"),
        resolve() {
          hero.state.starRingUsed = false;
        },
      },
      {
        id: "starRing",
        name: "星环",
        action: (game, p) =>
          hero.state.starRingUsed
            ? null
            : {
                type: "spell",
                cardCounts: Array.from(
                  {
                    length: Math.min(
                      p.hand.filter((c) =>
                        c
                          .getTraits({ game, playerId: p.id })
                          .elements.includes("earth"),
                      ).length,
                      6,
                    ),
                  },
                  (_, i) => i + 1,
                ),
                cardFilter: (c) =>
                  c
                    .getTraits({ game, playerId: p.id })
                    .elements.includes("earth"),
                targets: targets(game).filter((id) => id !== p.id),
                targetCountsByCardCount: Object.fromEntries(
                  Array.from({ length: 6 }, (_, i) => [i + 1, [i]]),
                ),
              },
        *resolveAction({ game, player, cards, targetIds, options }) {
          hero.state.starRingUsed = true;
          yield* discardCost(game, player, cards, "starRing", options);
          for (const id of seatOrder(game, player.id, [
            player.id,
            ...targetIds,
          ])) {
            game.changeHealing(id, 1);
            yield* game.drawSteps(id, 1, {
              ...options,
              cause: { type: "directDraw", skillId: "starRing" },
            });
          }
          game.turn.addAction({ type: "spell", sourceSkillId: "starRing" });
        },
      },
      {
        id: "starEngraving",
        name: "星刻",
        ...this.onOwnTurn([Timing.ATTACK_ACTION_END, Timing.SPELL_ACTION_END]),
        *resolve({ game, player }) {
          if (
            yield* game.offerSkill(
              player.id,
              "starEngraving",
              "星刻：牌库顶1牌作为卢恩",
            )
          )
            yield* hero.addRunes(game, player, 1);
        },
      },
      {
        id: "stellarRevelation",
        name: "群星启示",
        ...this.onOwnTurn([Timing.ACTIVATION]),
        activationEnablesAction: () => true,
        filter: ({ player }) =>
          (hero.laws().length < 3 && player.hand.length > 0) ||
          coveredCards(player, "rune").length > 0,
        *resolve({ game, player, options }) {
          const seeking = game.turn.state?.seekingAction || game.turn.state?.requiredActivationSkill === "stellarRevelation";
          const choices = seeking ? [] : [{ value: "skip", label: "不发动" }];
          if (hero.laws().length < 3 && player.hand.length)
            choices.push({ value: "add", label: "手牌盖为卢恩，放置律法" });
          if (coveredCards(player, "rune").length)
            choices.push({ value: "invoke", label: "移除卢恩发动律法" });
          const mode = yield* choice(
            player.id,
            "stellarRevelation",
            "群星启示",
            choices,
            choices[0]?.value,
          );
          if (mode === "skip") return;
          if (mode === "add") {
            const cs = yield* game.chooseHandCards(player.id, 1, () => true, {
              skillId: "revelationCard",
            });
            game.coverCards(player.id, cs, "rune");
            yield* game.flushCardMoves(options);
            yield* trimCovered(game, player, "rune", 6, "runeOverflow");
            const law = yield* choice(
              player.id,
              "revelationLaw",
              "选择律法",
              Object.keys(LAWS)
                .filter((k) => !hero.state[k])
                .map((value) => ({ value, label: LAWS[value] })),
            );
            hero.setLaw(game, player, law, true);
            yield* game.drawSteps(player.id, 0, {
              ...options,
              moraleLoss: false,
              cause: { type: "handLimit", skillId: "destinedLaw" },
            });
            const n = yield* choice(
              player.id,
              "revelationDraw",
              "摸0至1张牌",
              [
                ...(seeking ? [] : [{ value: 0, label: "不摸牌" }]),
                { value: 1, label: "摸1张牌" },
              ],
              seeking ? 1 : 0,
            );
            if (n)
              yield* game.drawSteps(player.id, 1, {
                ...options,
                cause: { type: "directDraw", skillId: "stellarRevelation" },
              });
          } else {
            const cs = yield* selectCovered(game, player, "rune", {
              skillId: "revelationRunes",
              min: 1,
              max: coveredCards(player, "rune").length,
            });
            const pattern = runePattern(game, player, cs);
            for (const c of cs)
              game.discardCovered(player.id, c, {
                reveal: true,
                skillId: "stellarRevelation",
              });
            for (const law of hero.laws())
              if (
                hero.qualifies(law, pattern) &&
                (yield* game.offerSkill(
                  player.id,
                  law,
                  `发动律法：${LAWS[law]}`,
                  pattern,
                ))
              )
                yield* hero.invoke(game, player, law, pattern, options);
            if (hero.laws().length) {
              const law = yield* choice(
                player.id,
                "removeLaw",
                "移除1个律法",
                hero.laws().map((value) => ({ value, label: LAWS[value] })),
              );
              hero.setLaw(game, player, law, false);
            }
          }
          if (
            player.hand.length < 2 &&
            (yield* game.offerSkill(
              player.id,
              "goldenLaw",
              "黄金律：摸1牌，可交换手牌与卢恩",
              { required: !game.usableHandCards(player.id).length },
            ))
          ) {
            yield* game.drawSteps(player.id, 1, {
              ...options,
              cause: { type: "directDraw", skillId: "goldenLaw" },
            });
            if (
              player.hand.length &&
              coveredCards(player, "rune").length &&
              (yield* game.offerSkill(
                player.id,
                "goldenSwap",
                "交换1手牌与1卢恩",
              ))
            ) {
              const [hand] = yield* game.chooseHandCards(
                player.id,
                1,
                () => true,
                { skillId: "goldenHand" },
              );
              const rune = yield* game.chooseCoveredCard(player.id, "rune", {
                skillId: "goldenRune",
              });
              game.moveCard(
                rune.id,
                { zone: "hand", playerId: player.id },
                { animate: false },
              );
              game.coverCards(player.id, [hand], "rune");
              yield* game.flushCardMoves(options);
              game.logSkill(
                player.id,
                "goldenLaw",
                `交换手牌与卢恩${game.describeCards([hand, rune], player.id, { hidden: true })}`,
              );
            }
          }
          // Covering and the optional swap may temporarily remove every usable
          // card. Judge only after Golden Law and the complete exchange finish.
          game.allowActivationRefresh(player.id, "stellarRevelation");
        },
      },
      { id: "goldenLaw", name: "黄金律" },
      ...Object.entries(LAWS).map(([id, name]) => ({
        id,
        name: `律法：${name}`,
      })),
      {
        id: "creationRhythm",
        name: "创刻律动",
        action: () => ({ type: "spell", energy: "gem", targetCount: 0 }),
        *resolveAction({ game, player, options }) {
          yield* game.paySkillEnergy(player.id, "gem");
          const n = yield* choice(
            player.id,
            "creationDraw",
            "无视手限摸0至1张牌",
            [
              { value: 0, label: "不摸牌" },
              { value: 1, label: "摸1张牌" },
            ],
            0,
          );
          if (n) {
            const ctx = {
              playerId: player.id,
              count: 1,
              cause: { type: "directDraw", skillId: "creationRhythm" },
              specialAction: false,
            };
            yield* game.trigger(Timing.DRAW_BEFORE, ctx, options);
            game.draw(player.id, ctx.count, {
              overflow: "defer",
              cause: ctx.cause,
            });
          }
          const count = yield* choice(
            player.id,
            "creationCount",
            "选择盖为卢恩的手牌数量",
            Array.from(
              {
                length:
                  Math.min(player.hand.length, 1 + hero.laws().length) + 1,
              },
              (_, value) => ({ value, label: `${value}张` }),
            ),
            0,
          );
          if (count) {
            const cs = yield* game.chooseHandCards(
              player.id,
              count,
              () => true,
              { skillId: "creationCards" },
            );
            game.coverCards(player.id, cs, "rune");
            yield* game.flushCardMoves(options);
            yield* trimCovered(game, player, "rune", 6, "runeOverflow");
          }
          if (player.hand.length <= player.handLimit)
            delete player.pendingOverflow;
          yield* game.drawSteps(player.id, 0, options);
        },
      },
    ];
  }
  laws() {
    return Object.keys(LAWS).filter((k) => this.state[k]);
  }
  initialize(game, p) {
    if (!this.skills.length) return;
    for (const law of Object.keys(LAWS)) {
      const name = `law${law[0].toUpperCase()}${law.slice(1)}`;
      if (!game.effects.has(name))
        game.registerEffect(name, {
          name: `律法：${LAWS[law]}`,
          category: "exclusive",
        });
      game.registerCard(new ExclusiveCard({ id: `${name}:${p.id}`, name }), {
        zone: "outside",
      });
    }
    this.setLaw(game, p, "starlight", true);
  }
  setLaw(game, p, law, active) {
    this.state[law] = active;
    const name = `law${law[0].toUpperCase()}${law.slice(1)}`,
      id = `${name}:${p.id}`;
    if (active)
      game.attachCard(id, p.id, { effectId: name, sourcePlayerId: p.id });
    else game.removeEffect(id, { zone: "outside" });
  }
  *addRunes(game, p, n) {
    game.coverDeck(p.id, n, "rune");
    yield* trimCovered(game, p, "rune", 6, "runeOverflow");
  }
  qualifies(law, x) {
    return law === "starlight"
      ? x.elements >= 4 || x.fates >= 4
      : law === "moonlight"
        ? x.elementPairs > 1 || x.fatePairs > 1
        : x.elementTriples > 0 || x.fateTriples > 0;
  }
  *invoke(game, p, law, x, options) {
    if (law === "starlight") {
      for (const id of seatOrder(game, p.id, enemies(game, p)))
        yield* game.damageSteps(id, 1, {
          ...options,
          sourceId: p.id,
          damageType: "spell",
          skillId: law,
        });
      if (x.elements >= 4 && x.fates >= 4) {
        const id = yield* game.choosePlayer(
          p.id,
          game.players
            .filter((t) => t.team === p.team && t.id !== p.id)
            .map((t) => t.id),
          "繁星：队友+1宝石",
          { skillId: "starlightGem" },
        );
        game.gainEnergy(id, "gem");
      }
    }
    if (law === "moonlight") {
      if (x.elementPairs > 1) {
        const id = yield* game.choosePlayer(
          p.id,
          targets(game),
          "影月：法伤目标",
          { skillId: "moonlightTarget" },
        );
        yield* game.damageSteps(id, x.elementPairs, {
          ...options,
          sourceId: p.id,
          damageType: "spell",
          skillId: law,
        });
      }
      if (x.fatePairs > 1) {
        const count = yield* choice(
          p.id,
          "moonlightRecipients",
          "治疗分给几人",
          [
            { value: 1, label: "1人" },
            { value: 2, label: "2人" },
          ],
        );
        const ids = yield* selectPlayers(
          game,
          p,
          game.players.filter((t) => t.team === p.team).map((t) => t.id),
          count,
          "moonlightHealing",
          "影月：治疗目标",
        );
        if (count === 1) game.changeHealing(ids[0], x.fatePairs);
        else {
          const n = yield* choice(
            p.id,
            "moonlightSplit",
            "第一名获得几点治疗",
            Array.from({ length: x.fatePairs - 1 }, (_, i) => ({
              value: i + 1,
              label: String(i + 1),
            })),
          );
          game.changeHealing(ids[0], n);
          game.changeHealing(ids[1], x.fatePairs - n);
        }
      }
    }
    if (law === "eclipse") {
      game.gainEnergy(p.id, "gem", x.elementTriples);
      const n = game.addStones(p.team, "gem", x.fateTriples);
      game.logSkill(p.id, law, `个人宝石增加，战绩宝石+${n}`);
    }
  }
}
