import { heroAI as marksman } from "../marksman/ai.js";
import { traits } from "../shared/ai/base/model.js";

// Reuse the rule policy, not a renamed game state. Only the hero's passive
// preference treats wind as Marksman's thunder; actual card traits stay intact.
export function magicArcherEXProfile() {
  return {
    ...marksman,
    retention(args) {
      const elements=args.elements.map(element=>element==='wind'?'thunder':element==='thunder'?'wind':element);
      return marksman.retention({...args,elements});
    },
    canCounter: elements=>!elements.includes("wind"),
    giftValue: (state,player,card)=>traits(card,player.id).includes("wind")?1.5:0,
  };
}
