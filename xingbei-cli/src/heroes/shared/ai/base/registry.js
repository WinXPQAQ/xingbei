import { heroAI as berserker } from "../../../berserker/ai.js";
import { heroAI as windSwordmaster } from "../../../wind-swordmaster/ai.js";
import { heroAI as marksman } from "../../../marksman/ai.js";
import { heroAI as sealer } from "../../../sealer/ai.js";
import { heroAI as guardianAngel } from "../../../guardian-angel/ai.js";
import { heroAI as priest } from "../../../priest/ai.js";
import { magicArcherEXProfile } from "../../../magic-archer-ex/ai.js";
import { swordWitchAi } from "../../../sword-witch/ai.js";
import { damageHealing } from "../wave-two/healing.js";

const heroes = Object.freeze({ berserker, windSwordmaster, marksman, sealer, guardianAngel, priest });
export const heroPolicies = Object.freeze(Object.values(heroes));
// Public recipient value is shared even when the acting hero uses another
// planner. Keep ownership of the heuristic in the recipient's hero module.
export const publicHandValue = player => player.hero === 'swordWitch' ? swordWitchAi.publicHandValue?.(player) ?? 0 : 0;
const empty = Object.freeze({});
export function aiFor(playerOrId) {
  const hero = typeof playerOrId === "string" ? playerOrId : playerOrId.hero;
  const id=typeof hero === "string" ? hero : hero.id;
  return id === "magicArcherEX" ? magicArcherEXProfile() : heroes[id] ?? empty;
}
export function aiForSkill(skillId) {
  return heroPolicies.find(policy => policy.skills?.includes(skillId) || policy.matchesSkill?.(skillId)) ?? empty;
}
export function healingCap(player, amount, type = 'attack', sourceId = null) {
  return damageHealing(player, amount, type, sourceId);
}
export function attackAmount(player) { return aiFor(player).attackAmount?.(player) ?? 2; }
