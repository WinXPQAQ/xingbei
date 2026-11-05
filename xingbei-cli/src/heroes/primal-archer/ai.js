import { holyArcherAi } from "../holy-archer/ai.js";
export const primalArcherAi = {
  ...holyArcherAi,
  id: "primalArcher",
  energyPreference: "mixed",
  scoreSkill(a, api) {
    if (a.skillId === "holyHurricane") {
      let element = a.costs[0].traits[a.id].elements.find((e) => a.costs[1].traits[a.id].elements.includes(e));
      if (element === "light") element = "dark";
      const card = { id: null, name: `${element}Strike`, type: "attack", elements: [element], fates: ["S"], uniqueSkills: [],
        traits: Object.fromEntries(a.next.players.map((p) => [p.id, { elements: [element], fates: ["S"] }])) };
      const branches = api.attackOutcomes(a.game, a.id, a.next, card, a.targetId, { alreadyPlayed: true });
      return api.scoreBranches(branches) - api.evaluate(a.next) +
        branches.reduce((n, b) => n + b.probability * (b.bonus ?? 0), 0);
    }
    if (a.skillId === "holyBurst" && a.action.mode === "support") {
      api.draw(a.next, a.id, 1);
      a.player.healing--;
      a.player.heroState.faith = Math.min(10, a.player.heroState.faith + 1);
      const targets = a.next.players.filter(
        (t) => t.team !== a.player.team && t.count < a.player.count,
      );
      if (targets.length) {
        const t = targets.sort(
          (x, y) =>
            api.damageGain(a.next, a.id, y.id, 2, "attack") -
            api.damageGain(a.next, a.id, x.id, 2, "attack"),
        )[0];
        api.hurt(a.next, t.id, 2, "attack");
      }
      return 1;
    }
    const cannon = a.player.heroState.cannon;
    const result = holyArcherAi.scoreSkill(a, api);
    if (a.skillId === "holyBurst" && !api.terminal(a.next))
      a.player.heroState.faith = Math.min(10, a.player.heroState.faith + Number(a.action.mode.split(":")[1]));
    if (a.skillId === "radiantCannon") {
      // The first shot flips the exclusive cannon to afterglow; it does not
      // consume both shots. Its team healing is absent from the base hero.
      a.player.heroState.cannon = Math.max(0, cannon - 1);
      if (cannon === 2 && !api.terminal(a.next))
        for (const p of a.next.players.filter((p) => p.team === a.player.team)) api.heal(a.next, p.id, 1);
    }
    return result;
  },
  decisions: {
    ...holyArcherAi.decisions,
    primalBurstTarget: ({ request, state, id }, api) =>
      [...request.choices].sort((a, b) => api.damageGain(state, id, b.value, 2, "attack") -
        api.damageGain(state, id, a.value, 2, "attack"))[0]?.value ?? request.defaultValue,
    primalCannonExtra: ({ source }) =>
      source.hand.some((c) => c.type === "attack") ? "attack" : "spell",
  },
};
