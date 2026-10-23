import { Hero } from "../hero-base.js";
import { Timing } from "../timing.js";
import { sameElements, distinctElements } from "../card-sets.js";
import { targets, discardCost } from "./actions.js";

const counts = (hand, minimum) =>
  Array.from({ length: Math.max(0, Math.min(7, hand.length) - minimum + 1) }, (_, index) => index + minimum);

export class Sage extends Hero {
  constructor(enabled = true) {
    super({ id: "sage", name: "贤者" });
    if (!enabled) return;
    this.skills = [
      {
        id: "wisdomCodex",
        name: "智慧法典",
        modifyEnergyLimit: (limit) => limit + 1,
        ...this.onDamage([Timing.DAMAGE_AFTER], "target", ["spell"]),
        filter: ({ context }) => context.actual > 3,
        *resolve({ game, player, options }) {
          game.logSkill(player.id, "wisdomCodex", "承受超过3点法术伤害，获得2宝石并暗弃1张牌");
          game.gainEnergy(player.id, "gem", 2);
          if (!player.hand.length) return;
          const cards = yield* game.chooseHandCards(player.id, 1, () => true, {
            title: "智慧法典：暗弃1张牌", skillId: "wisdomCodex",
          });
          yield* discardCost(game, player, cards, "wisdomCodex", options, "hidden");
        },
      },
      {
        id: "spellRebound",
        name: "法术反弹",
        ...this.onDamage([Timing.DAMAGE_AFTER], "target", ["spell"]),
        filter: ({ game, player, context }) => context.actual === 1 && player.hand.some((card, i) =>
          player.hand.slice(i + 1).some((other) => sameElements(game, player.id, [card, other]))),
        *resolve({ game, player, context, options }) {
          const cards = yield* game.chooseCardSet(player.id, {
            counts: Array.from({ length: player.hand.length - 1 }, (_, index) => index + 2),
            cardsFilter: (selected) => sameElements(game, player.id, selected),
            skillId: "spellRebound", title: "法术反弹：可明弃至少2张同系牌", optional: true,
            context: { sourceId: context.sourceId, amount: context.actual },
          });
          if (!cards) return;
          const targetId = yield* game.choosePlayer(player.id, targets(game), "法术反弹：选择伤害目标", {
            skillId: "spellRebound", context: { amount: cards.length - 1, damageType: "spell" },
          });
          game.logSkill(player.id, "spellRebound", `明弃${cards.length}张同系牌；对${game.actorLabel(targetId)}造成${cards.length - 1}法术伤害，再对自己造成${cards.length}法术伤害`);
          yield* discardCost(game, player, cards, "spellRebound", options);
          yield* game.damageSteps(targetId, cards.length - 1, {
            ...options, sourceId: player.id, damageType: "spell", skillId: "spellRebound",
          });
          yield* game.damageSteps(player.id, cards.length, {
            ...options, sourceId: player.id, damageType: "spell", skillId: "spellRebound",
          });
        },
      },
      {
        id: "arcaneCodex",
        name: "魔道法典",
        action(game, player) {
          const cardCounts = counts(player.hand, 2);
          if (!cardCounts.length) return null;
          return {
            type: "spell", energy: "gem", cardCounts,
            cardsFilter: (cards) => distinctElements(game, player.id, cards),
            targets: targets(game),
          };
        },
        *resolveAction({ game, player, cards, targetIds, options }) {
          yield* game.paySkillEnergy(player.id, "gem");
          yield* discardCost(game, player, cards, "arcaneCodex", options);
          const amount = cards.length - 1;
          game.logSkill(player.id, "arcaneCodex", `先对${game.actorLabel(targetIds[0])}、再对自己各造成${amount}点法术伤害`);
          yield* game.damageSteps(targetIds[0], amount, {
            ...options, sourceId: player.id, damageType: "spell", skillId: "arcaneCodex",
          });
          yield* game.damageSteps(player.id, amount, {
            ...options, sourceId: player.id, damageType: "spell", skillId: "arcaneCodex",
          });
        },
      },
      {
        id: "holyCodex",
        name: "圣洁法典",
        action(game, player) {
          const cardCounts = counts(player.hand, 3);
          if (!cardCounts.length) return null;
          return {
            type: "spell", energy: "gem", cardCounts,
            cardsFilter: (cards) => distinctElements(game, player.id, cards),
            targets: targets(game),
            targetCountsByCardCount: Object.fromEntries(cardCounts.map((count) => [count,
              Array.from({ length: Math.min(count - 2, game.players.length) }, (_, index) => index + 1)])),
          };
        },
        *resolveAction({ game, player, cards, targetIds, options }) {
          yield* game.paySkillEnergy(player.id, "gem");
          yield* discardCost(game, player, cards, "holyCodex", options);
          for (const id of targetIds) game.changeHealing(id, 2);
          const amount = cards.length - 1;
          game.logSkill(player.id, "holyCodex", `为${targetIds.map((id) => game.actorLabel(id)).join("、")}各增加2治疗；再对自己造成${amount}点法术伤害`);
          yield* game.damageSteps(player.id, amount, {
            ...options, sourceId: player.id, damageType: "spell", skillId: "holyCodex",
          });
        },
      },
    ];
  }
}
