import { cheapCards, damageTarget } from "../shared/ai/decisions.js";
export const lawgiverAi = {
  id: "lawgiver",
  sharedDecisionSkills: ["royalPressure"],
  cardBonus: ({ card }) => (card.type === "attack" ? 10 : 0),
  resourceValue: (p) =>
    (p.heroState.relics ?? 0) * 4 + (p.heroState.silverBullets ?? 0) * 3,
  attackDamage: ({ active }) => (active ? 1 : 0),
  refineBonus: ({ crystal, player }) =>
    crystal && !player.energy.crystal ? 6 : 0,
  scoreSkill({ next, id, player, skillId }, api) {
    if (skillId !== "castling") return null;
    player.heroState.silverBullets = Math.min(
      3,
      player.heroState.silverBullets + 2,
    );
    return player.hand.some((c) => c.type === "attack") ? 7 : 0;
  },
  decisions: {
    castlingHealing: ({ request, state, player }) =>
      [...request.choices].sort(
        (a, b) =>
          Number(state.players[a.value].team === player.team) -
          Number(state.players[b.value].team === player.team),
      )[0].value,
    sinAbsolution: ({ request }) =>
      Math.max(...request.choices.map((c) => c.value)),
    silverGrace: ({ source }) => source.hand.some((c) => c.type === "attack"),
    faithReforged: (a, api) =>
      a.player.energy.gem + a.player.energy.crystal &&
      a.state.teams[a.player.team].morale > 4
        ? cheapCards(a, api)
        : null,
    royalPressure: (a, api) =>
      a.player.count + 2 > a.player.limit
        ? cheapCards(a, api)
        : a.player.team === a.state.players[a.context.sourceId]?.team
          ? cheapCards(a, api)
          : null,
    orbReturn: ({ player, request }) =>
      player.count >= player.limit
        ? (request.choices.find(
            (c) =>
              typeof c.value === "number" &&
              c.value === Math.min(2, player.heroState.silverBullets),
          )?.value ?? "cardinal")
        : "cardinal",
    orbDrawTarget: damageTarget,
  },
};
