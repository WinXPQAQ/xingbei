import { Timing } from "./timing.js";

// Each attached card is a separate effect instance. Definitions share rules only.
export const BASIC_EFFECTS = {
  poison: {
    id: "poison",
    category: "basic", stackable: true, priority: 3, timings: [Timing.ACTION_PHASE_BEFORE],
    *resolve({ game, player, card, options }) {
      game.log.push(`${game.actorLabel(player.id)}触发【中毒】${card.attachment.sourcePlayerId == null ? "" : `（来自${game.actorLabel(card.attachment.sourcePlayerId)}）`}，结算1点法术伤害`);
      yield* game.damageSteps(player.id, 1, { sourceId: card.attachment.sourcePlayerId, damageType: "spell", overflow: options.overflow, useHealing: options.poisonHealing });
      game.removeEffect(card.id);
      yield* game.present();
      if (player.pendingOverflow) yield { type: "overflow", player };
    },
  },
  weakness: {
    id: "weakness",
    category: "basic", stackable: false, priority: 1, timings: [Timing.ACTION_PHASE_BEFORE],
    *resolve({ game, player, card, context, options }) {
      game.log.push(`${player.name}行动阶段开始前，触发【虚弱】`);
      const choice = yield { type: "weakness", player, card };
      game.removeEffect(card.id);
      if (choice === "draw") {
        game.draw(player.id, 3, { overflow: options.overflow });
        game.log.push(`${player.name}选择摸3张牌取消【虚弱】，本回合继续行动`);
        yield* game.present();
        if (player.pendingOverflow) yield { type: "overflow", player };
      } else {
        context.skipped = true;
        game.log.push(`${player.name}选择不摸牌，因【虚弱】跳过本回合行动`);
      }
    },
  },
  holyShield: {
    id: "holyShield",
    category: "basic", stackable: false, priority: -1, timings: [Timing.ATTACK_HIT_CHECK, Timing.MAGIC_HIT_CHECK],
    *resolve({ game, player, card, context }) {
      if (!context.hit || context.shieldable === false) return;
      context.hit = false; context.cause = "holyShield"; context.causeCardId = card.id;
      game.removeEffect(card.id);
      game.log.push(`${player.name}的【圣盾】抵消了伤害，未命中`);
    },
  },
};
