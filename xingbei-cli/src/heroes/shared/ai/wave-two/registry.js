import { saintAi } from "../../../saint/ai.js";
import { holyLancerAi } from "../../../holy-lancer/ai.js";
import { plagueMageAi } from "../../../plague-mage/ai.js";
import { elementalistAi } from "../../../elementalist/ai.js";
import { magicalGirlAi } from "../../../magical-girl/ai.js";
import { valkyrieAi } from "../../../valkyrie/ai.js";

// Resolve the objects after module initialization: hero helpers also use shared
// scoring, so eagerly reading these objects would create an import-order hazard.
export function heroPolicies() {
  return { saint: saintAi, holyLancer: holyLancerAi, plagueMage: plagueMageAi,
    elementalist: elementalistAi, magicalGirl: magicalGirlAi, valkyrie: valkyrieAi };
}
export const heroIds = new Set(["saint", "holyLancer", "plagueMage", "elementalist", "magicalGirl", "valkyrie"]);
export const heroPolicy = (g, id) => heroPolicies()[g.player(id).hero.id];
