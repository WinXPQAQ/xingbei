import { holyArcherAi } from "../holy-archer/ai.js";
export const trickHolyArcherAi = {
  ...holyArcherAi,
  id: "trickHolyArcher",
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
