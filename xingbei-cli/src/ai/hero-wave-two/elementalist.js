import { cardScore, elements } from "./cards.js";
export const elementalSkills = Object.freeze({
  meteor: "earth",
  freeze: "water",
  fireball: "fire",
  windBlade: "wind",
  lightning: "thunder",
});
// Extra damage is useful pressure even before overflow. Prefer the least valuable
// same-element card; this choice is shared by action estimates and the real offer.
export function enhancementCard(g, id, skillId, targetId, cards) {
  const element = elementalSkills[skillId];
  if (
    !element ||
    targetId == null ||
    g.player(targetId).team === g.player(id).team
  )
    return null;
  return (
    cards
      .filter((c) => elements(g, id, c).includes(element))
      .sort((a, b) => cardScore(g, id, a) - cardScore(g, id, b))[0] ?? null
  );
}
export function refinementAdjustment(g, id, action) {
  const p = g.player(id),
    hero = p.hero.id,
    { gem, crystal } = action.stones,
    total = gem + crystal;
  if (!["elementalist", "magicalGirl", "plagueMage"].includes(hero))
    return total < 2 ? -12 : 0;
  if (hero === "elementalist") {
    const team = g.stoneCounts(p.team),
      single = team.gem === 1 && team.crystal <= 1 && gem === 1;
    if (p.energy.crystal + crystal > 1 || (total < 2 && !single)) return -1e6;
  } else if (total < 2) return -12;
  // The first gem opens their gem-only spell. Crystals alone cannot open it.
  let bonus = 0;
  for (let i = 0; i < gem; i++) bonus += p.energy.gem + i === 0 ? 26 : 6;
  if (
    hero === "elementalist" &&
    crystal &&
    p.energy.crystal === 0 &&
    p.energy.gem + gem > 0
  )
    bonus += 8;
  if (hero !== "elementalist" && crystal) bonus -= 2 * crystal;
  // Do not take the team's immediately available fifth cup away for preparation.
  const stones = g.stoneCounts(p.team);
  if (
    g.teams[p.team].cups === 4 &&
    stones.total >= 3 &&
    stones.total - total < 3
  )
    bonus -= 30;
  return bonus;
}
