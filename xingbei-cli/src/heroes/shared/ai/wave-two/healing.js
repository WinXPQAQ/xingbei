import { damageHealing as priestHealing } from "../../../priest/ai-magic.js";
import { damageHealing as plagueHealing } from "../../../plague-mage/ai.js";

const modifiers = { priest: priestHealing, plagueMage: plagueHealing };
export function damageHealing(player, amount, type = "attack", sourceId = null) {
  const hero = typeof player.hero === "string" ? player.hero : player.hero.id;
  if (player.healingDisabled || (hero === "redLotusKnight" && sourceId !== player.id)) return 0;
  return modifiers[hero]?.(player, amount, type) ?? Math.min(player.healing, amount);
}
export function moraleLoss(player, amount, type = "attack", sourceId = null) {
  return Math.max(0, player.hand.length + Math.max(0, amount - damageHealing(player, amount, type, sourceId)) - player.handLimit);
}

// Damage overflow is distinct from ordinary draws, even in the same form.
export function preventsDamageMoraleLoss(player) {
  const hero=typeof player.hero==='string'?player.hero:player.hero.id;
  return hero==='redLotusKnight'&&Boolean(player.heroState?.form??player.hero.state?.form);
}
