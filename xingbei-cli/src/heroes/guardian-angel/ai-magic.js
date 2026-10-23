import { payEnergy } from "../shared/ai/base/model.js";

export function protectMagicOverflow(state, target, loss) {
  for (const angel of state.players.filter(
    (player) => player.team === target.team && player.skillIds.includes("divineShelter"),
  )) {
    const used = Math.min(loss, angel.energy.gem + angel.energy.crystal);
    payEnergy(state, angel.id, used);
    loss -= used;
  }
  return loss;
}
