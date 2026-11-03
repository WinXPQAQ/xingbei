import {
  cheapCards,
  cheapCovered,
  damageTarget,
  discardTarget,
} from "../shared/ai/decisions.js";
export const orchestraLeaderAi = {
  id: "orchestraLeader",
  cardBonus: ({ elements }) =>
    elements.includes("water")
      ? 12
      : elements.some((e) => ["wind", "earth"].includes(e))
        ? 6
        : 0,
  resourceValue: (p) => p.coveredCount * 2,
  attackHitBonus: () => 3,
  decisions: {
    barlettaMinor: ({ player, request }) =>
      request.type === "skillChoice"
        ? player.count >= player.limit - 1
        : undefined,
    newMovement: ({ context, id, player, state, request }) =>
      request.type !== "skillChoice"
        ? undefined
        : !(
            context.effect === "damage" &&
            context.targetIds?.length === 1 &&
            context.targetIds[0] === id
          ) &&
          !(
            context.effect === "heal" &&
            context.targetIds?.every(
              (t) => state.players[t].team !== player.team,
            )
          ),
    movementdamage: damageTarget,
    movementdiscard: discardTarget,
    provenceConcerto: () => false,
    concertoStones: ({ request }) => request.choices[0].value,
    concertoCount: ({ request }) => request.choices.at(-1).value,
    concertoNote: cheapCovered,
    naplesSolo: () => false,
    soloCard: cheapCards,
    noteElement: ({ request }) =>
      request.choices.find((c) => c.value === "water")?.value ??
      request.defaultValue,
  },
};
