import { damageHealing as priestHealing } from "../../../priest/ai-magic.js";
import { damageHealing as plagueHealing } from "../../../plague-mage/ai.js";

const modifiers = { priest: priestHealing, plagueMage: plagueHealing };
export function damageHealing(player, amount, type = "attack") {
  const hero = typeof player.hero === "string" ? player.hero : player.hero.id;
  return modifiers[hero]?.(player, amount, type) ?? Math.min(player.healing, amount);
}
export function moraleLoss(player, amount, type = "attack") {
  return Math.max(0, player.hand.length + Math.max(0, amount - damageHealing(player, amount, type)) - player.handLimit);
}
