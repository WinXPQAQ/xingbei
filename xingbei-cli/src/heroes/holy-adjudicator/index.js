import { Hero } from "../../hero-base.js";
import { ExclusiveCard } from "../../card.js";
import { Timing } from "../../timing.js";
import { sameElements } from "../../card-sets.js";
import { choice, targets, enemies } from "../shared/actions.js";
import { coveredCards, seatOrder } from "../shared/covered.js";
import { chooseVisibleCard } from "../shared/compound.js";
export class HolyAdjudicator extends Hero {
  constructor(enabled = true) {
    super({ id: "holyAdjudicator", name: "圣仲裁者" });
    this.state = {
      sins: 0,
      noSins: false,
      form: null,
      reckoningUsed: false,
      leftScaleId: null,
      rightScaleId: null,
    };
    if (!enabled) return;
    this.skills = [
      { id: "divineScales", name: "神之天平" },
      {
        id: "scalesReset",
        name: "善恶计数重置",
        ...this.bind("player", [Timing.TURN_BEFORE], "all"),
        resolve: () => {
          this.state.reckoningUsed = false;
        },
      },
      {
        id: "goodEvilReckoning",
        name: "善恶必计",
        ...this.bind("target", [Timing.DAMAGE_AFTER], "team"),
        filter: ({ player }) =>
          !this.state.reckoningUsed &&
          this.openSides(player).length > 0 &&
          player.hand.some((c) => c.category === "basic"),
        *resolve({ game, player, options }) {
          const cards = yield* game.chooseHandCards(
            player.id,
            1,
            (c) => c.category === "basic",
            {
              skillId: "goodEvilReckoning",
              optional: true,
              title: "善恶必计：放置一张基础牌到天平，再摸1",
            },
          );
          if (!cards) return;
          player.hero.state.reckoningUsed = true;
          yield* player.hero.place(game, player, cards[0], null, options);
          yield* game.drawSteps(player.id, 1, {
            ...options,
            cause: { type: "directDraw", skillId: "goodEvilReckoning" },
          });
        },
      },
      {
        id: "tiltingScales",
        name: "天平倾倒",
        ...this.onOwnTurn([Timing.TURN_START, Timing.TURN_END]),
        priority: 10,
        filter: ({ player }) =>
          Math.abs(
            coveredCards(player, "leftScale").length -
              coveredCards(player, "rightScale").length,
          ) > 1,
        *resolve({ game, player, options }) {
          const side =
            coveredCards(player, "leftScale").length >
            coveredCards(player, "rightScale").length
              ? "leftScale"
              : "rightScale";
          yield* player.hero.clear(game, player, side, options);
          const shown = [];
          for (let i = 0; i < 4; i++) {
            const c = game.takeDeckCard();
            if (!c) break;
            game.moveCard(c.id, { zone: "field" });
            shown.push(c);
          }
          game.logSkill(
            player.id,
            "tiltingScales",
            `展示${game.describeCards(shown, player.id)}`,
          );
          const chosen = [];
          for (let i = 0; i < Math.min(2, shown.length); i++)
            chosen.push(
              yield* chooseVisibleCard(
                game,
                player.id,
                shown.filter((c) => !chosen.includes(c)),
                "scaleDraw",
                "天平倾倒：选择加入手牌的牌",
              ),
            );
          for (const c of shown)
            game.moveCard(
              c.id,
              chosen.includes(c)
                ? { zone: "hand", playerId: player.id }
                : { zone: "discard" },
            );
          yield* game.drawSteps(player.id, 0, {
            ...options,
            cause: { type: "directDraw", skillId: "tiltingScales" },
          });
          player.hero.gainSin(game, player);
          const id = yield* game.choosePlayer(
            player.id,
            game.players
              .filter((p) => p.team === player.team && p.id !== player.id)
              .map((p) => p.id),
            "天平倾倒：队友+2治疗",
            { skillId: "scaleHealing" },
          );
          game.changeHealing(id, 2);
        },
      },
      {
        id: "divineJudgment",
        name: "神之审判",
        ...this.onOwnTurn([Timing.TURN_END]),
        filter: ({ player }) =>
          coveredCards(player, "leftScale").length === 3 &&
          coveredCards(player, "rightScale").length === 3,
        *resolve({ game, player, options }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "divineJudgment",
              "神之审判：清空两侧天平，对2名对手各2攻击伤害",
            ))
          )
            return;
          yield* player.hero.clear(game, player, "leftScale", options);
          yield* player.hero.clear(game, player, "rightScale", options);
          const ids = [];
          for (let i = 0; i < 2; i++)
            ids.push(
              yield* game.choosePlayer(
                player.id,
                enemies(game, player).filter((id) => !ids.includes(id)),
                "神之审判：选择不同目标",
                { skillId: "divineJudgmentTarget" },
              ),
            );
          for (const id of seatOrder(game, player.id, ids))
            yield* game.damageSteps(id, 2, {
              ...options,
              sourceId: player.id,
              damageType: "attack",
              skillId: "divineJudgment",
            });
        },
      },
      {
        id: "heavenSin",
        name: "天罪",
        ...this.onOwnTurn([Timing.ACTIVATION]),
        filter: ({ game, player }) => game.canPayEnergy(player.id, "crystal"),
        *resolve({ game, player }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "heavenSin",
              "天罪：1水晶，+1罪，主动命中时可向天平放牌",
            ))
          )
            return;
          yield* game.paySkillEnergy(player.id, "crystal");
          player.hero.gainSin(game, player);
          player.hero.state.form = "heavenSin";
        },
      },
      {
        id: "heavenSinHit",
        name: "天罪放牌",
        ...this.onOwnAttack([Timing.ATTACK_HIT]),
        filter: ({ player, context }) =>
          this.state.form &&
          this.isActiveAttack(context) &&
          this.openSides(player).length > 0,
        *resolve({ game, player, options }) {
          const sides = player.hero.openSides(player);
          const cards = yield* game.chooseHandCards(
            player.id,
            sides.length,
            (c) => c.category === "basic",
            {
              skillId: "heavenSinCards",
              optional: true,
              title: "天罪：选基础牌分别置于未满天平",
            },
          );
          if (!cards) return;
          let ordered = cards;
          if (cards.length === 2) {
            const first = yield* chooseVisibleCard(
              game,
              player.id,
              cards,
              "leftScaleCard",
              "选择放在左侧天平的牌",
            );
            ordered = [first, cards.find((c) => c !== first)];
          }
          for (let i = 0; i < sides.length; i++)
            if (ordered[i].location.zone === "hand")
              yield* player.hero.place(
                game,
                player,
                ordered[i],
                sides[i],
                options,
              );
        },
      },
      {
        id: "sinArrives",
        name: "罪迟必到",
        action: () => ({ type: "spell", energy: "crystal", targetCount: 0 }),
        *resolveAction({ game, player, options }) {
          yield* game.paySkillEnergy(player.id, "crystal");
          let n = player.hero.state.sins;
          player.hero.state.sins = 0;
          player.hero.state.noSins = true;
          while (n-- && player.hero.openSides(player).length) {
            const cs = yield* game.chooseHandCards(
              player.id,
              1,
              (c) => c.category === "basic",
              {
                skillId: "sinArrivesCard",
                optional: true,
                title: "罪迟必到：可向天平放置基础牌",
              },
            );
            if (!cs) break;
            yield* player.hero.place(game, player, cs[0], null, options);
          }
        },
      },
      {
        id: "heavenSinEnd",
        name: "天罪结束",
        ...this.onOwnTurn([Timing.TURN_END]),
        priority: -100,
        resolve: () => {
          this.state.form = null;
          this.state.noSins = false;
        },
      },
    ];
  }
  initialize(game, p) {
    if (!this.skills.length) return;
    for (const side of ["left", "right"]) {
      const name = `${side}Scale`;
      this.state[`${name}Id`] = `${name}:${p.id}`;
      if (!game.effects.has(name))
        game.registerEffect(name, {
          name: side === "left" ? "天平·左" : "天平·右",
          category: "exclusive",
        });
      game.registerCard(
        new ExclusiveCard({ id: this.state[`${name}Id`], name }),
        { zone: "outside" },
      );
      game.attachCard(this.state[`${name}Id`], p.id, {
        effectId: name,
        sourcePlayerId: p.id,
      });
    }
  }
  openSides(p) {
    return ["leftScale", "rightScale"].filter(
      (side) => coveredCards(p, side).length < 3,
    );
  }
  gainSin(game, p) {
    const old = this.state.sins;
    if (!this.state.noSins) this.state.sins = Math.min(3, old + 1);
    game.logSkill(
      p.id,
      "divineScales",
      `罪+${this.state.sins - old}（${this.state.sins}/3）`,
    );
  }
  *clear(game, p, side, options) {
    const cards = coveredCards(p, side);
    for (const c of cards)
      game.discardCovered(p.id, c, { reveal: true, skillId: "divineScales" });
    if (side === "rightScale" && cards.length > 1) game.changeHealing(p.id, 1);
    yield* game.flushRuleEvents(options);
  }
  *place(game, p, card, side, options) {
    if (!side)
      side = yield* choice(
        p.id,
        "scaleSide",
        "选择放置天平",
        this.openSides(p).map((value) => ({
          value,
          label: value === "leftScale" ? "天平·左" : "天平·右",
        })),
      );
    const old = coveredCards(p, side);
    if (old.length >= 3) return;
    if (old.length && !sameElements(game, p.id, [...old, card])) {
      yield* this.clear(game, p, side, options);
      this.gainSin(game, p);
    }
    game.coverCards(p.id, [card], side, { reveal: true });
    yield* game.flushRuleEvents(options);
    const count = coveredCards(p, side).length;
    if (side === "leftScale" && count > 1) {
      const ids = [];
      for (let i = 1; i < count; i++)
        ids.push(
          yield* game.choosePlayer(
            p.id,
            enemies(game, p).filter((id) => !ids.includes(id)),
            "罪灭之左：选择1攻击伤害目标",
            { skillId: "leftScaleTarget" },
          ),
        );
      for (const id of seatOrder(game, p.id, ids))
        yield* game.damageSteps(id, 1, {
          ...options,
          sourceId: p.id,
          damageType: "attack",
          skillId: "divineScales",
        });
    }
  }
}
