import { holyArcherAi } from "../holy-archer/ai.js";
export const trickHolyArcherAi = {
  ...holyArcherAi,
  id: "trickHolyArcher",
  energyPreference: "mixed",
  scoreSkill(a, api) {
    const result = holyArcherAi.scoreSkill(a, api);
    if (a.skillId === "radiantCannon" && !api.terminal(a.next))
      for (const p of a.next.players.filter((p) => p.team === a.player.team)) api.heal(a.next, p.id, 1);
    return result;
  },
  decisions: {
    ...holyArcherAi.decisions,
    trickFill: ({ player, request }) =>
      player.heroState.cannon === 0
        ? "crystal"
        : player.energy.gem
          ? "gem"
          : "crystal",
  },
};
