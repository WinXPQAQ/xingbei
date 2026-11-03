import { adventurerAi } from "../adventurer/ai.js";
export const trickAdventurerAi = {
  ...adventurerAi,
  id: "trickAdventurer",
  scoreSkill(a, api) {
    if (a.skillId !== "adventurerParadise")
      return adventurerAi.scoreSkill(a, api);
    const [g, c] = (a.action.mode ?? "0:1").split(":").map(Number);
    const team = a.next.teams[a.player.team];
    team.gem -= g;
    team.crystal -= c;
    const extra = Math.min(1, team.crystal);
    team.crystal -= extra;
    api.payEnergy(a.next, a.id, 1, "crystal");
    const allies = a.next.players
      .filter((p) => p.team === a.player.team && p.id !== a.id)
      .sort(
        (a, b) =>
          a.energy.gem + a.energy.crystal - (b.energy.gem + b.energy.crystal),
      );
    allies[0].energy.gem = Math.min(
      allies[0].energyLimit,
      allies[0].energy.gem + g,
    );
    allies[0].energy.crystal = Math.min(
      allies[0].energyLimit - allies[0].energy.gem,
      allies[0].energy.crystal + c + extra,
    );
    return g + c >= 2 ? 3 : -20;
  },
  decisions: {
    ...adventurerAi.decisions,
    trickParadiseCost: ({ request }) =>
      [...request.choices].sort((a, b) => {
        const cost = (v) => v.split(":").reduce((n, x) => n + Number(x), 0);
        return (
          cost(a.value) - cost(b.value) ||
          Number(a.value.split(":")[0]) - Number(b.value.split(":")[0])
        );
      })[0].value,
    trickParadiseTarget: ({ request, state }) =>
      [...request.choices].sort(
        (a, b) =>
          state.players[a.value].energy.gem +
          state.players[a.value].energy.crystal -
          (state.players[b.value].energy.gem +
            state.players[b.value].energy.crystal),
      )[0].value,
  },
};
