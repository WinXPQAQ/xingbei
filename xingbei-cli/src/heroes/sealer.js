import { Timing } from "../timing.js";
import { ExclusiveCard } from "../card.js";
export const SEAL_ELEMENTS = ["earth", "water", "fire", "wind", "thunder"];
const labels = { earth: "地", water: "水", fire: "火", wind: "风", thunder: "雷" };
export const sealerEffects = Object.fromEntries(SEAL_ELEMENTS.map(element => [`${element}Seal`, {
  id: `${element}Seal`, name: `${labels[element]}之封印`, category: "basic", stackable: false, isSeal: true, priority: 1, timings: [Timing.CARD_EXPOSED],
  filter: ({ player, context }) => context.playerId === player.id && !context.covered && context.origin === "hand" && context.visibility === "public" && context.traits.some(traits => traits.elements.includes(element)),
  *resolve({ game, player, card, options }) {
    const sourceId = card.attachment.sourcePlayerId;
    game.removeEffect(card.id);
    yield* game.damageSteps(player.id, 3, { ...options, sourceId, damageType: "spell" });
    if (player.pendingOverflow) yield { type: "overflow", player };
  },
}]));
sealerEffects.fivefoldBinding = {
  id: "fivefoldBinding", name: "五系束缚", category: "exclusive", priority: 2, timings: [Timing.ACTION_PHASE_BEFORE],
  *resolve({ game, player, card, context, options }) {
    const seals = game.players.flatMap(player => player.statuses).filter(card => game.effects.get(card.attachment.effectId)?.isSeal).length;
    const weakness = player.getStatus("weakness")[0];
    const count = 2 + Math.min(2, seals) + (weakness ? 3 : 0);
    const choice = yield { type: "bindingChoice", playerId: player.id, title: "五系束缚", choices: [{ value: "draw", label: `摸${count}张牌并继续` }, { value: "skip", label: "跳过行动阶段" }], defaultValue: "skip" };
    if (!["draw", "skip"].includes(choice)) throw new Error("无效的五系束缚选择");
    game.removeEffect(card.id, { zone: "outside" });
    if (weakness) game.removeEffect(weakness.id);
    if (choice === "draw") {
      game.draw(player.id, count, { overflow: options.overflow, cause: { type: "directDraw", skillId: "fivefoldBinding" } });
      yield* game.present(); if (player.pendingOverflow) yield { type: "overflow", player };
    } else context.skipped = true;
  },
};
export function initializeSealer(game) {
  for (const [id, definition] of Object.entries(sealerEffects)) game.registerEffect(id, definition);
  for (const player of game.players.filter(player => player.hero.id === "sealer" && player.hero.skills.length)) {
    const card = new ExclusiveCard({ id: `fivefoldBinding-${player.id}`, name: "fivefoldBinding", heroId: "sealer" });
    game.registerCard(card, { zone: "outside" }); player.hero.state.bindingCardId = card.id;
  }
}
export const sealerSkills = [
  { id: "spellExcitation", name: "法术激荡", timings: [Timing.SPELL_ACTION_END], filter: ({ player, context }) => context.playerId === player.id,
    *resolve({ game, player }) { if (yield* game.offerSkill(player.id, "spellExcitation", "法术激荡")) game.turn.addAttackAction({ sourceSkillId: "spellExcitation" }); } },
  ...SEAL_ELEMENTS.map(element => ({
    id: `${element}Seal`, name: `${labels[element]}之封印`,
    action(game, player) { return { type: "spell", cardCount: 1, cardFilter: card => card.hasUniqueSkill(`${element}Seal`), targets: game.players.filter(target => target.team !== player.team && !target.getStatus(`${element}Seal`).length).map(target => target.id) }; },
    *resolveAction({ game, player, cards, targetIds, options }) {
      game.playCard(player, player.hand.indexOf(cards[0]), options);
      game.attachCard(cards[0].id, targetIds[0], { effectId: `${element}Seal`, sourcePlayerId: player.id, sourceSkillId: `${element}Seal` });
    },
  })),
  { id: "fivefoldBinding", name: "五系束缚", action(game, player) {
      if (game.cards.get(player.hero.state.bindingCardId)?.location.zone !== "outside") return null;
      return { type: "spell", energy: "crystal", targets: game.players.filter(target => target.team !== player.team && !target.getStatus("fivefoldBinding").length).map(target => target.id) };
    },
    *resolveAction({ game, player, targetIds }) { yield* game.paySkillEnergy(player.id, "crystal"); game.attachCard(player.hero.state.bindingCardId, targetIds[0], { effectId: "fivefoldBinding", sourcePlayerId: player.id, sourceSkillId: "fivefoldBinding" }); } },
  { id: "sealBreaking", name: "封印破碎", action(game) {
      return { type: "spell", energy: "crystal", targets: game.players.filter(player => player.getBasicEffects().length).map(player => player.id) };
    },
    *resolveAction({ game, player, targetIds, options }) {
      const target = game.player(targetIds[0]), effects = target.getBasicEffects();
      const id = yield { type: "effectChoice", playerId: player.id, title: "封印破碎：选择收入手中的基础效果", choices: effects.map(card => ({ value: card.id, label: `${game.effects.get(card.attachment.effectId)?.name ?? card.attachment.effectId} #${card.id}` })), defaultValue: effects[0].id };
      if (!effects.some(card => card.id === id)) throw new Error("无效的基础效果");
      yield* game.paySkillEnergy(player.id, "crystal");
      game.removeEffect(id, { zone: "hand", playerId: player.id });
      game.draw(player.id, 0, { overflow: options.overflow });
    } },
];
