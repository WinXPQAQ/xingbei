import { adventurerAi } from "../adventurer/ai.js";
export const trickAdventurerAi = {
  ...adventurerAi,
  id: "trickAdventurer",
  energyPreference: "crystal",
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
    const allies = a.next.players.filter((p) => p.team === a.player.team && p.id !== a.id);
    // The rule assigns each stone separately. Preserve both colours already in
    // a teammate's area, and account for their actual remaining capacity.
    const space = (p) => p.energyLimit - p.energy.gem - p.energy.crystal;
    for (const kind of [...Array(g).fill("gem"), ...Array(c + extra).fill("crystal")]) {
      const recipient = [...allies].sort((x, y) => space(y) - space(x))[0];
      if (recipient && space(recipient) > 0) recipient.energy[kind]++;
    }
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
          (state.players[b.value].energyLimit - state.players[b.value].energy.gem - state.players[b.value].energy.crystal) -
          (state.players[a.value].energyLimit - state.players[a.value].energy.gem - state.players[a.value].energy.crystal),
      )[0].value,
  },
};
