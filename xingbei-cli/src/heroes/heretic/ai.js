import {
  cheapCards,
  cheapCovered,
  damageTarget,
} from "../shared/ai/decisions.js";
export const hereticAi = {
  id: "heretic",
  sharedDecisionSkills: ["calamityDefense"],
  cardBonus: ({ card }) => (card.type === "spell" ? 7 : 0),
  resourceValue: (p) => (p.heroState.prophecyFace ? 4 : 0),
  refineBonus: ({ player, crystal }) =>
    crystal && !player.energy.crystal ? 10 : 0,
  scoreSkill({ player, skillId }) {
    if (skillId !== "banishment") return null;
    return player.count <= 3 ? 10 : 3;
  },
  decisions: {
    banishmentDraw: ({ player }) => (player.count < 4 ? 7 : 6),
    prophecyFace: ({ source }) =>
      source.hand.filter((c) =>
        c.elements.some((e) => ["thunder", "fire"].includes(e)),
      ).length >=
      source.hand.filter((c) =>
        c.elements.some((e) => ["earth", "water"].includes(e)),
      ).length
        ? "thunderFire"
        : "earthWater",
    prophecyCards: cheapCards,
    banishmentAction: ({ source }) =>
      source.hand.some((c) => c.type === "attack") ? "attack" : "spell",
    heresyJudgment: () => true,
    judgmentTarget: damageTarget,
    judgmentCard: cheapCovered,
    sacrifice: () => true,
    sacrificeElement: () => "water",
    greed: ({ player }) => player.count >= 3,
    calamityOrder: ({ request, source }) =>
      [...request.choices].sort(
        (a, b) =>
          source.hand.filter((c) => c.elements.includes(b.value)).length -
          source.hand.filter((c) => c.elements.includes(a.value)).length,
      )[0].value,
    calamityCost: (a, api) =>
      cheapCards(
        {
          ...a,
          request: {
            ...a.request,
            validSets: [...a.request.validSets]
              .sort((x, y) => y.length - x.length)
              .filter(
                (x) =>
                  x.length ===
                  Math.max(...a.request.validSets.map((s) => s.length)),
              ),
          },
        },
        api,
      ),
    calamityDefense: ({ request }) =>
      [...request.validSets].sort((a, b) => b.length - a.length)[0],
    calamityTarget: (a, api) => damageTarget(a, api, a.context.amount ?? 2),
  },
};
