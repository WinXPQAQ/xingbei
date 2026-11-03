import { Hero } from "../../hero-base.js";
import { Timing } from "../../timing.js";
import { targets, enemies, spendStones } from "../shared/actions.js";
import { discardHand, seatOrder } from "../shared/covered.js";
import { selectPlayers } from "../shared/selection.js";
import { adjustHand } from "../shared/compound.js";
export class NobleLady extends Hero {
  constructor(enabled = true) {
    super({ id: "nobleLady", name: "矜贵之女" });
    this.state = { lessons: 0, friendshipUsed: false };
    if (!enabled) return;
    const hero = this;
    this.skills = [
      {
        id: "nobleReset",
        name: "魔法入门计数",
        ...this.bind("player", [Timing.TURN_BEFORE], "all"),
        resolve({ player, context }) {
          hero.state.friendshipUsed = false;
          if (player.id === context.playerId) hero.state.lessons = 0;
        },
      },
      {
        id: "highbornFlower",
        name: "高岭之花",
        ...this.onOwnTurn([Timing.SPECIAL_ACTION_END]),
        filter: ({ context }) => context.refinedStones?.gem > 0,
        resolve({ game, player }) {
          game.gainEnergy(player.id, "crystal");
          game.logSkill(
            player.id,
            "highbornFlower",
            "提炼包含宝石，额外获得1水晶",
          );
        },
      },
      {
        id: "magicLesson",
        name: "魔法入门",
        action: () => ({ type: "spell", targetCount: 0 }),
        *resolveAction({ game, player, options }) {
          hero.state.lessons++;
          let cards = [],
            allies = [];
          if (
            !hero.state.friendshipUsed &&
            game.canPayEnergy(player.id, "gem") &&
            (yield* game.offerSkill(
              player.id,
              "friendshipBond",
              "友情羁绊：宝石，改为两名我方角色弃牌后补牌",
            ))
          ) {
            hero.state.friendshipUsed = true;
            yield* game.paySkillEnergy(player.id, "gem");
            allies = yield* selectPlayers(
              game,
              player,
              game.players
                .filter((p) => p.team === player.team)
                .map((p) => p.id),
              2,
              "friendshipTargets",
              "选择两名我方角色",
            );
            for (const id of seatOrder(game, player.id, allies))
              cards.push(
                ...(yield* discardHand(
                  game,
                  id,
                  1,
                  "friendshipCost",
                  options,
                  "public",
                )),
              );
          } else {
            cards = yield* game.drawSteps(player.id, 1, {
              ...options,
              cause: { type: "directDraw", skillId: "magicLesson" },
            });
            game.queueExposure(player.id, cards, { reason: "magicLesson" });
            game.logSkill(
              player.id,
              "magicLesson",
              `展示${game.describeCards(cards, player.id)}`,
            );
            yield* game.flushRuleEvents(options);
          }
          const spell = cards.some((c) => c.type === "spell"),
            fates = cards.filter((c) =>
              c.getTraits({ game, playerId: player.id }).fates.includes("Y"),
            ).length,
            water = cards.filter((c) =>
              c
                .getTraits({ game, playerId: player.id })
                .elements.includes("water"),
            ).length;
          if (spell) {
            const ids = yield* selectPlayers(
              game,
              player,
              enemies(game, player),
              2,
              "lessonSpellTargets",
              "魔法入门：两名对手各1法伤",
            );
            for (const id of seatOrder(game, player.id, ids))
              yield* game.damageSteps(id, 1, {
                ...options,
                sourceId: player.id,
                damageType: "spell",
                skillId: "magicLesson",
              });
          }
          if (fates) {
            const ids = yield* selectPlayers(
              game,
              player,
              targets(game),
              fates,
              "lessonFateTargets",
              "魔法入门：咏命格法伤目标",
            );
            for (const id of seatOrder(game, player.id, ids))
              yield* game.damageSteps(id, 1, {
                ...options,
                sourceId: player.id,
                damageType: "spell",
                skillId: "magicLesson",
              });
          }
          if (water) {
            const ids = yield* selectPlayers(
              game,
              player,
              targets(game),
              water,
              "lessonHealing",
              "魔法入门：水系治疗目标",
            );
            for (const id of seatOrder(game, player.id, ids))
              game.changeHealing(id, 1);
          }
          for (const id of seatOrder(game, player.id, allies))
            yield* game.drawSteps(id, 1, {
              ...options,
              cause: { type: "directDraw", skillId: "friendshipBond" },
            });
          if (
            yield* game.offerSkill(
              player.id,
              "magicSpark",
              spell || fates || water
                ? "Magic!：弃2牌"
                : "Magic!：额外法术行动",
              {
                triggered: !!(spell || fates || water),
                count: hero.state.lessons,
              },
            )
          ) {
            if (spell || fates || water)
              yield* discardHand(game, player.id, 2, "magicSparkCost", options);
            else
              game.turn.addAction({
                type: "spell",
                sourceSkillId: "magicSpark",
              });
            if (hero.state.lessons === 3) {
              const n = game.addStones(player.team, "gem", 2);
              game.logSkill(
                player.id,
                "magicSpark",
                `第三次魔法入门，战绩宝石+${n}`,
              );
            }
          }
        },
      },
      { id: "magicSpark", name: "Magic!" },
      { id: "friendshipBond", name: "友情羁绊" },
      {
        id: "wishFulfillment",
        name: "强予愿行",
        ...this.onOwnTurn([Timing.ACTIVATION]),
        filter: ({ game, player }) => game.canPayEnergy(player.id, "crystal"),
        *resolve({ game, player, options }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "wishFulfillment",
              "强予愿行：水晶，手牌调整至4张",
            ))
          )
            return;
          yield* game.paySkillEnergy(player.id, "crystal");
          yield* adjustHand(game, player.id, 4, "wishFulfillmentCost", options);
          if (
            game.stoneCounts(player.team).total &&
            (yield* game.offerSkill(
              player.id,
              "sharedWish",
              "额外移除1战绩星石，将其他角色手牌调整为4",
            ))
          ) {
            yield* spendStones(game, player, "wishStone", 1);
            const id = yield* game.choosePlayer(
              player.id,
              targets(game).filter((id) => id !== player.id),
              "调整目标手牌为4",
              { skillId: "wishTarget" },
            );
            yield* adjustHand(game, id, 4, "wishFulfillmentCost", options);
          }
        },
      },
    ];
  }
}
