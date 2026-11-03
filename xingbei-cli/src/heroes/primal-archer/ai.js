import { holyArcherAi } from "../holy-archer/ai.js";
import { damageTarget } from "../shared/ai/decisions.js";
export const primalArcherAi = {
  ...holyArcherAi,
  id: "primalArcher",
  scoreSkill(a, api) {
    if (a.skillId === "holyBurst" && a.action.mode === "support") {
      api.draw(a.next, a.id, 1);
      a.player.healing--;
      a.player.heroState.faith++;
      const targets = a.next.players.filter(
        (t) => t.team !== a.player.team && t.count < a.player.count,
      );
      if (targets.length) {
        const t = targets.sort(
          (x, y) =>
            api.damageGain(a.next, a.id, y.id, 2) -
            api.damageGain(a.next, a.id, x.id, 2),
        )[0];
        api.hurt(a.next, t.id, 2, "attack");
      }
      return 1;
    }
    return holyArcherAi.scoreSkill(a, api);
  },
  decisions: {
    ...holyArcherAi.decisions,
    primalBurstTarget: (a, api) => damageTarget(a, api, 2),
    primalCannonExtra: ({ source }) =>
      source.hand.some((c) => c.type === "attack") ? "attack" : "spell",
  },
};
