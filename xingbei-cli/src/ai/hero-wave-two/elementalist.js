import { cardScore, elements } from "./cards.js";
export const elementalSkills = Object.freeze({
  meteor: "earth",
  freeze: "water",
  fireball: "fire",
  windBlade: "wind",
  lightning: "thunder",
});
// Action planning and the real payment share this preference. Another hero's
// printed label is an ordinary card here; only our five unique spells are kept.
const ownElementalSkill = (card) =>
  Object.keys(elementalSkills).some((skill) => card.hasUniqueSkill(skill));
export function enhancementCard(g, id, skillId, targetId, cards, { state = null } = {}) {
  const element = elementalSkills[skillId];
  if (!element || targetId == null || g.player(targetId).team === g.player(id).team)
    return null;
  const available = cards
    .filter((c) => elements(g, id, c).includes(element))
    .sort((a, b) => cardScore(g, id, a) - cardScore(g, id, b));
  const ordinary = available.find((c) => !ownElementalSkill(c));
  if (ordinary) return ordinary;
  // Preserve our own unique spells. Spend one only if the extra point is the
  // difference between not winning and winning through all public healing.
  const t = state?.players[targetId], actual = g.player(targetId);
  const hero = t?.hero ?? actual.hero.id,
    count = t?.count ?? actual.hand.length,
    limit = t?.limit ?? actual.handLimit,
    healing = t?.healing ?? actual.healing;
  const morale = (state?.teams ?? g.teams)[actual.team].morale;
  const shelter = (state?.players ?? g.players)
    .filter((p) => p.team === actual.team &&
      (p.skillIds?.includes("divineShelter") ??
        p.getSkills().some(({ skill }) => skill.id === "divineShelter")))
    .reduce((n, p) => n + p.energy.gem + p.energy.crystal, 0);
  const loss = (amount) => Math.max(0,
    count + Math.max(0, amount - Math.min(healing, hero === "priest" ? 1 : amount)) -
    limit - shelter);
  const base = skillId === "fireball" ? 2 : 1;
  return loss(base) < morale && loss(base + 1) >= morale ? available[0] ?? null : null;
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
