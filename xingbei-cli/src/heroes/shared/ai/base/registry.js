import { heroAI as berserker } from "../../../berserker/ai.js";
import { heroAI as windSwordmaster } from "../../../wind-swordmaster/ai.js";
import { heroAI as marksman } from "../../../marksman/ai.js";
import { heroAI as sealer } from "../../../sealer/ai.js";
import { heroAI as guardianAngel } from "../../../guardian-angel/ai.js";
import { heroAI as priest } from "../../../priest/ai.js";

const heroes = Object.freeze({ berserker, windSwordmaster, marksman, sealer, guardianAngel, priest });
export const heroPolicies = Object.freeze(Object.values(heroes));
const empty = Object.freeze({});
export function aiFor(playerOrId) {
  const hero = typeof playerOrId === "string" ? playerOrId : playerOrId.hero;
  return heroes[typeof hero === "string" ? hero : hero.id] ?? empty;
}
export function aiForSkill(skillId) {
  return heroPolicies.find(policy => policy.skills?.includes(skillId) || policy.matchesSkill?.(skillId)) ?? empty;
}
export function healingCap(player, amount) {
  return Math.min(player.healing, aiFor(player).healingCap ?? amount);
}
export function attackAmount(player) { return aiFor(player).attackAmount?.(player) ?? 2; }
