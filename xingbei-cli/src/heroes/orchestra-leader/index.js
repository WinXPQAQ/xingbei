import { Hero } from "../../hero-base.js";
import { Timing } from "../../timing.js";
import { choice, targets, enemies } from "../shared/actions.js";
import { coveredCards, discardHand, seatOrder } from "../shared/covered.js";
export class OrchestraLeader extends Hero {
  constructor(enabled = true) {
    super({ id: "orchestraLeader", name: "乐团首席" });
    this.state.notesLocked = false;
    if (!enabled) return;
    this.skills = [
      { id: "basqueFingering", name: "巴斯克指法？" },
      {
        id: "notesReset",
        name: "独奏结束",
        ...this.onOwnTurn([Timing.TURN_END]),
        priority: -100,
        resolve: () => {
          this.state.notesLocked = false;
        },
      },
      {
        id: "demonicMelody",
        name: "魔性旋律",
        ...this.onOwnTurn([Timing.ATTACK_ACTION_END, Timing.SPELL_ACTION_END]),
        *resolve({ game, player, options }) {
          yield* player.hero.addNote(game, player, options);
        },
      },
      { id: "newMovement", name: "新乐章" },
      {
        id: "barlettaMinor",
        name: "巴列塔尼小调",
        ...this.onOwnAttack([Timing.ATTACK_HIT]),
        filter: ({ context }) => this.isActiveAttack(context),
        *resolve({ game, player, options }) {
          if (
            yield* game.offerSkill(
              player.id,
              "barlettaMinor",
              "巴列塔尼小调：加入1音符，然后弃1牌",
            )
          ) {
            yield* player.hero.addNote(game, player, options);
            yield* discardHand(game, player.id, 1, "barlettaMinor", options);
          }
        },
      },
      {
        id: "provenceConcerto",
        name: "普罗旺斯协奏曲",
        ...this.onOwnTurn([Timing.ACTIVATION]),
        filter: ({ game, player }) =>
          game.stoneCounts(player.team).total >= 2 &&
          coveredCards(player, "notes").length > 0,
        *resolve({ game, player, options }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "provenceConcerto",
              "普罗旺斯协奏曲：2星石，移除X音符，依次放置X−1音符",
            ))
          )
            return;
          const stones = game.stoneCounts(player.team),
            costs = [];
          for (let gem = 0; gem <= 2; gem++)
            if (gem <= stones.gem && 2 - gem <= stones.crystal)
              costs.push({ value: gem, label: `${gem}宝石、${2 - gem}水晶` });
          const gem = yield* choice(
            player.id,
            "concertoStones",
            "选择2星石",
            costs,
          );
          game.removeStones(player.team, { gem, crystal: 2 - gem });
          const n = yield* choice(
            player.id,
            "concertoCount",
            "选择移除音符数量",
            coveredCards(player, "notes").map((_, i) => ({
              value: i + 1,
              label: `${i + 1}个`,
            })),
          );
          for (let i = 0; i < n; i++) {
            const c = yield* game.chooseCoveredCard(player.id, "notes", {
              skillId: "concertoNote",
            });
            game.discardCovered(player.id, c, {
              reveal: true,
              skillId: "provenceConcerto",
            });
          }
          for (let i = 1; i < n; i++)
            yield* player.hero.addNote(game, player, options);
        },
      },
      { id: "naplesSolo", name: "那不勒斯独奏" },
    ];
  }
  *addNote(game, p, options) {
    let card = game.takeDeckCard();
    if (!card) return;
    game.moveCard(card.id, { zone: "field" });
    game.logSkill(
      p.id,
      "demonicMelody",
      `展示${game.describeCards([card], p.id)}`,
    );
    if (this.state.notesLocked) {
      game.moveCard(card.id, { zone: "discard" });
      game.logSkill(p.id, "naplesSolo", "本回合不能增加音符，展示牌弃置");
      return;
    }
    if (
      game.canPayEnergy(p.id, "crystal") &&
      p.hand.length &&
      (yield* game.offerSkill(
        p.id,
        "naplesSolo",
        "那不勒斯独奏：1水晶，用手牌替换新音符，本回合不能再增加音符",
      ))
    ) {
      yield* game.paySkillEnergy(p.id, "crystal");
      game.moveCard(card.id, { zone: "discard" });
      const selected = yield* game.chooseHandCards(p.id, 1, () => true, {
        skillId: "soloCard",
      });
      card = selected[0];
      this.state.notesLocked = true;
    }
    const notes = coveredCards(p, "notes");
    if (notes.length >= 3)
      game.discardCovered(p.id, notes[0], {
        reveal: true,
        skillId: "basqueFingering",
      });
    game.coverCards(p.id, [card], "notes", { reveal: true });
    yield* game.flushRuleEvents(options);
    if (coveredCards(p, "notes").length === 3)
      yield* this.movement(game, p, options);
  }
  *movement(game, p, options) {
    const notes = coveredCards(p, "notes");
    const es = [];
    for (const c of notes) {
      const choices = c.getTraits({ game, playerId: p.id }).elements;
      es.push(
        choices.length === 1
          ? choices[0]
          : yield* choice(
              p.id,
              "noteElement",
              "新乐章：选择音符系别",
              choices.map((value) => ({ value, label: value })),
            ),
      );
    }
    const [a, b, c] = es;
    let ids =
        a === "water"
          ? targets(game)
          : ["wind", "earth"].includes(a)
            ? enemies(game, p)
            : [p.id],
      n = 1;
    if (c === "water") {
      ids = targets(game);
      n = 2;
    } else if (["wind", "earth"].includes(c)) {
      ids = enemies(game, p);
      n = 2;
    }
    const effect =
      b === "water"
        ? "heal"
        : ["wind", "earth"].includes(b)
          ? "discard"
          : "damage";
    if (
      !(yield* game.offerSkill(
        p.id,
        "newMovement",
        "新乐章：按三个音符执行效果",
        { effect, targetIds: ids, count: n },
      ))
    )
      return;
    const chosen = [];
    for (let i = 0; i < n; i++)
      chosen.push(
        ids.length === 1
          ? ids[0]
          : yield* game.choosePlayer(
              p.id,
              ids.filter((id) => !chosen.includes(id)),
              `新乐章：选择${effect === "heal" ? "治疗" : effect === "discard" ? "弃牌" : "法伤"}目标`,
              { skillId: `movement${effect}` },
            ),
      );
    for (const id of seatOrder(game, p.id, chosen))
      if (effect === "heal") game.changeHealing(id, 1);
      else if (effect === "discard")
        yield* discardHand(game, id, 1, "newMovement", options);
      else
        yield* game.damageSteps(id, 1, {
          ...options,
          sourceId: p.id,
          damageType: "spell",
          skillId: "newMovement",
        });
  }
}
