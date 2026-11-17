import { heroPolicy } from "./registry.js";
import { acceptsCrystalRefinement as berserkerCrystals } from "../../../berserker/ai-refinement.js";

const otherHeroes = { berserker: berserkerCrystals };
// These are AI candidate preferences; the engine's legal actions stay intact.
export function acceptsRefinement(game, id, action) {
  if (action.type !== "refine" || !action.stones.crystal) return true;
  const player = game.player(id);
  const preference = heroPolicy(game, id)?.acceptsCrystalRefinement ?? otherHeroes[player.hero.id];
  return preference?.(player, action) ?? true;
}
export function refinementAdjustment(game, id, action) {
  return heroPolicy(game, id)?.refinementAdjustment?.(game, id, action) ?? (action.stones.gem + action.stones.crystal < 2 ? -12 : 0);
}
