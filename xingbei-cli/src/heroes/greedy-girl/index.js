import { Hero } from "../../hero-base.js";
import { Timing } from "../../timing.js";
import {
  enemies,
  hasElement,
  discardCost,
  useUnique,
} from "../shared/actions.js";
import { magicRelaySteps } from "../../resolution/magic.js";
import { seatOrder } from "../shared/covered.js";
export class GreedyGirl extends Hero {
  constructor(enabled = true) {
    super({ id: "greedyGirl", name: "贪婪少女" });
    this.state.blackHoleUsed = false;
    if (!enabled) return;
    this.skills = [
      {
        id: "greedReset",
        name: "贪欲重置",
        ...this.onOwnTurn([Timing.TURN_START]),
        resolve: ({ player }) => {
          player.hero.state.blackHoleUsed = false;
        },
      },
      {
        id: "greedBlackHole",
        name: "贪欲黑洞",
        action(game, player) {
          return player.hero.state.blackHoleUsed
            ? null
            : {
                type: "spell",
                cardCount: 1,
                cardFilter: (c) => c.type === "spell",
                targets: enemies(game, player),
              };
        },
        *resolveAction({ game, player, cards, targetIds, options }) {
          player.hero.state.blackHoleUsed = true;
          yield* discardCost(game, player, cards, "greedBlackHole", options);
          const added = game.addStones(player.team, "crystal");
          game.logSkill(
            player.id,
            "greedBlackHole",
            `战绩区获得${added}水晶，本回合不能发动亡女的金库`,
          );
          const target = game.player(targetIds[0]);
          const cost = yield* game.chooseHandCards(
            target.id,
            1,
            (c) => c.type === "spell",
            {
              optional: true,
              skillId: "blackHoleResponse",
              title: "贪欲黑洞：明弃1张法术牌，否则承受2点法术伤害",
            },
          );
          if (cost)
            yield* discardCost(game, target, cost, "greedBlackHole", options);
          else {
            yield* game.damageSteps(target.id, 2, {
              ...options,
              sourceId: player.id,
              damageType: "spell",
              skillId: "greedBlackHole",
            });
            game.turn.addAction({
              type: "spell",
              sourceSkillId: "greedBlackHole",
            });
          }
        },
      },
      {
        id: "goldenAlchemy",
        name: "殓金魔法",
        ...this.onDamage([Timing.DAMAGE_AFTER], "actor", ["spell"]),
        filter: ({ context }) => context.skillId === "magicBullet",
        resolve({ game, player }) {
          const n = game.addStones(player.team, "crystal");
          game.logSkill(
            player.id,
            "goldenAlchemy",
            `魔弹伤害结算完毕，战绩区获得${n}水晶`,
          );
        },
      },
      {
        id: "alchemy",
        name: "炼金术",
        action(game, player) {
          return {
            type: "spell",
            cardCount: 1,
            cardFilter: (c) => player.hero.canRelayMagic(game, player, c),
            targets: game.magicTargets(player.id),
          };
        },
        *resolveAction({ game, player, cards, options }) {
          yield* useUnique(game, player, cards[0], options);
          yield* magicRelaySteps(game, player.id, options);
        },
      },
      {
        id: "deadGirlsVault",
        name: "亡女的金库",
        action(game, player) {
          return player.hero.state.blackHoleUsed
            ? null
            : {
                type: "spell",
                energy: "crystal",
                targets: enemies(game, player),
                targetCount: 2,
              };
        },
        *resolveAction({ game, player, targetIds, options }) {
          yield* game.paySkillEnergy(player.id, "crystal");
          const stones = game.stoneCounts(player.team);
          let bonus = 0,
            gems = 0;
          if (
            stones.gem + stones.crystal > 0 &&
            (yield* game.offerSkill(
              player.id,
              "emptyVault",
              "亡女的金库：移除战绩区所有星石，每2颗伤害+1",
              { targetIds },
            ))
          ) {
            bonus = Math.floor((stones.gem + stones.crystal) / 2);
            gems = stones.gem;
            game.removeStones(player.team, stones);
            game.logSkill(
              player.id,
              "deadGirlsVault",
              `移除${stones.gem}宝石、${stones.crystal}水晶，每个目标伤害+${bonus}`,
            );
          }
          for (const id of seatOrder(game, player.id, targetIds))
            yield* game.damageSteps(id, 1 + bonus, {
              ...options,
              sourceId: player.id,
              damageType: "spell",
              skillId: "deadGirlsVault",
            });
          if (gems > 1) {
            const team = game.player(targetIds[0]).team,
              before = game.teams[team].morale;
            yield* game.changeMoraleSteps(team, -1, {
              ...options,
              sourceId: player.id,
              skillId: "deadGirlsVault",
            });
            if (!game.winner && game.teams[team].morale < before)
              yield* game.changeMoraleSteps(player.team, 1, {
                ...options,
                sourceId: player.id,
                skillId: "deadGirlsVault",
              });
          }
        },
      },
    ];
  }
  canRelayMagic(game, player, card) {
    return (
      this.skills.length > 0 &&
      ["thunder", "fire"].some((e) => hasElement(game, player, card, e))
    );
  }
}
