import { Hero } from "../../hero-base.js";
import { magicRelaySteps } from "../../resolution/magic.js";
import { enemies, hasElement, discardCost, useUnique } from "../shared/actions.js";
export class MagicalGirl extends Hero {
  constructor(enabled = true) {
    super({ id: "magicalGirl", name: "魔法少女" });
    if (!enabled) return;
    this.skills = [
      { id: "magicMastery", name: "魔弹掌握" },
      {
        id: "magicFusion",
        name: "魔弹融合",
        action(game, player) {
          return {
            type: "spell",
            cardCount: 1,
            cardFilter: (c) =>
              hasElement(game, player, c, "earth") ||
              hasElement(game, player, c, "fire"),
            targets: game.magicTargets(player.id),
          };
        },
        *resolveAction({ game, player, cards, targetIds, options }) {
          yield* useUnique(game, player, cards[0], options);
          game.logSkill(player.id, "magicFusion", "将打出的牌视为魔弹");
          const direction =
            targetIds[0] === game.nearestOpponent(player.id)?.id ? 1 : -1;
          yield* magicRelaySteps(game, player.id, { ...options, direction });
        },
      },
      {
        id: "magicBurst",
        name: "魔爆冲击",
        action(game, player) {
          return {
            type: "spell",
            cardCount: 1,
            cardFilter: (c) => c.type === "spell",
            targets: enemies(game, player),
            targetCount: 2,
          };
        },
        *resolveAction({ game, player, cards, targetIds, options }) {
          yield* discardCost(game, player, cards, "magicBurst", options);
          const added = game.addStones(player.team, "gem");
          game.logSkill(player.id, "magicBurst", `战绩区获得${added}宝石`);
          for (const id of targetIds) {
            const target = game.player(id);
            const discard = target.hand.some((c) => c.type === "spell")
              ? yield* game.chooseHandCards(id, 1, (c) => c.type === "spell", {
                  title: "魔爆冲击：明弃1张法术牌，否则承受2点法术伤害",
                  skillId: "magicBurst",
                  optional: true,
                })
              : null;
            if (discard)
              yield* discardCost(game, target, discard, "magicBurst", options);
            else {
              yield* game.damageSteps(id, 2, {
                ...options,
                sourceId: player.id,
                damageType: "spell",
                skillId: "magicBurst",
              });
              if (player.hand.length) {
                const payment = yield* game.chooseHandCards(
                  player.id,
                  1,
                  () => true,
                  { title: "魔爆冲击：弃1张牌", skillId: "magicBurst" },
                );
                yield* discardCost(
                  game,
                  player,
                  payment,
                  "magicBurst",
                  options,
                  "hidden",
                );
              }
            }
          }
        },
      },
      {
        id: "destructionStorm",
        name: "毁灭风暴",
        action(game, player) {
          return {
            type: "spell",
            energy: "gem",
            targets: enemies(game, player),
            targetCount: 2,
          };
        },
        *resolveAction({ game, player, targetIds, options }) {
          yield* game.paySkillEnergy(player.id, "gem");
          for (const id of targetIds)
            yield* game.damageSteps(id, 2, {
              ...options,
              sourceId: player.id,
              damageType: "spell",
              skillId: "destructionStorm",
            });
        },
      },
    ];
  }
}
