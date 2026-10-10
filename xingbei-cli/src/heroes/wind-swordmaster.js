import { Timing } from "../timing.js";
const ownAttack = ({ player, context }) => context.actorId === player.id;
const ownEnd = ({ player, context }) => context.playerId === player.id && context.actionType === "attack";
export const windSwordmasterSkills = [
  { id: "windFury", name: "风怒追击", timings: [Timing.ATTACK_ACTION_END],
    filter: payload => ownEnd(payload) && !payload.context.usedSkills.windFury && payload.player.hand.some(card => card.type === "attack" && card.getTraits({ game: payload.game, playerId: payload.player.id }).elements.includes("wind")),
    *resolve({ game, player, context }) { if (yield* game.offerSkill(player.id, "windFury", "风怒追击")) { context.usedSkills.windFury = true; game.turn.addAttackAction({ element: "wind", sourceSkillId: "windFury" }); } } },
  { id: "holySword", name: "圣剑", timings: [Timing.ATTACK_DECLARED, Timing.ATTACK_ACTION_END],
    filter: payload => payload.timing === Timing.ATTACK_DECLARED ? ownAttack(payload) && !payload.context.isCounter && payload.game.turn.state?.attackCount === 3 : ownEnd(payload) && payload.context.holySwordRefresh,
    *resolve({ game, player, context, timing, options }) {
      if (timing === Timing.ATTACK_DECLARED) { context.forceHitRequested = true; game.turn.state.holySwordRefresh = true; return; }
      context.holySwordRefresh = false;
      const count = yield { type: "numberChoice", playerId: player.id, title: "圣剑：摸X张再弃X张", choices: [0,1,2,3].map(value => ({ value, label: `${value}张` })), defaultValue: 0 };
      if (![0,1,2,3].includes(count)) throw new Error("圣剑数量必须为0至3");
      if (!count) return;
      game.draw(player.id, count, { overflow: "defer", moraleLoss: false }); yield* game.present();
      const cards = yield* game.chooseHandCards(player.id, count, () => true, { title: "圣剑：弃置手牌" });
      game.discardCards(player.id, cards, { visibility: "hidden", reason: "holySword" });
      yield* game.present();
      if (player.pendingOverflow) yield { type: "overflow", player };
    } },
  { id: "stormArt", name: "烈风技", timings: [Timing.ATTACK_DECLARED],
    filter: payload => ownAttack(payload) && payload.context.card.hasUniqueSkill("stormArt") && payload.game.player(payload.context.targetId).getStatus("holyShield").length > 0,
    *resolve({ game, player, context }) { if (yield* game.offerSkill(player.id, "stormArt", "烈风技")) { context.shieldable = false; context.canCounter = false; } } },
  { id: "galeArt", name: "疾风技", timings: [Timing.ATTACK_DECLARED],
    filter: payload => ownAttack(payload) && !payload.context.isCounter && payload.context.card.hasUniqueSkill("galeArt"),
    *resolve({ game, player }) { if (yield* game.offerSkill(player.id, "galeArt", "疾风技")) game.turn.addAttackAction({ sourceSkillId: "galeArt" }); } },
  { id: "swordShadow", name: "剑影", timings: [Timing.ATTACK_ACTION_END],
    filter: payload => ownEnd(payload) && !payload.context.usedSkills.swordShadow && payload.game.canPayEnergy(payload.player.id, "crystal"),
    *resolve({ game, player, context }) { if (yield* game.offerSkill(player.id, "swordShadow", "剑影（消耗1水晶）")) { yield* game.paySkillEnergy(player.id, "crystal"); context.usedSkills.swordShadow = true; game.turn.addAttackAction({ sourceSkillId: "swordShadow" }); } } },
];
