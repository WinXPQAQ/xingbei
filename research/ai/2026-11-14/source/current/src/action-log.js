import { CARD_NAMES } from "./card-labels.js";
import { ELEMENT_NAMES, FATE_NAMES } from "./cards.js";
import { UNIQUE_SKILL_NAMES } from "./unique-skills.js";

// Format at the time of the action, before traits/ownership can change.
export function logCard(card, game, playerId) {
  const traits = card.getTraits({ game, playerId, purpose: "log" });
  const elements = traits.elements.map(value => `[${ELEMENT_NAMES[value] ?? value}]`).join("");
  const fates = traits.fates.map(value => `[${FATE_NAMES[value] ?? value}]`).join("");
  const type = card.type === "attack" ? "攻击" : card.type === "spell" ? "法术" : "专属牌";
  return `${elements}${fates}${type}【${CARD_NAMES[card.name] ?? card.name}】`;
}
export function skillLabel(player, skillId) {
  return player.getSkills().map(({ skill }) => skill).find(skill => skill.id === skillId)?.name ?? UNIQUE_SKILL_NAMES[skillId] ?? skillId;
}
export function effectLabel(game, effectId) {
  return game.effects.get(effectId)?.name ?? CARD_NAMES[effectId] ?? UNIQUE_SKILL_NAMES[effectId] ?? effectId;
}
