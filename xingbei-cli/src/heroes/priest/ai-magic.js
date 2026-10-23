// Priest spends at most one healing on an individual damage event.
export const damageHealing = (player, amount) => Math.min(player.healing, 1, amount);
