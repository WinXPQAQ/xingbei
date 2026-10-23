// Refinement preferences constrain AI candidates, not the game's legal actions.
// These heroes have gem-only skills and no benefit from holding crystals.
const gemOnlyHeroes = new Set([
  "berserker",
  "holyLancer",
  "plagueMage",
  "magicalGirl",
]);
export function acceptsRefinement(game, id, action) {
  if (action.type !== "refine" || !action.stones.crystal) return true;
  const player = game.player(id);
  if (gemOnlyHeroes.has(player.hero.id)) return false;
  // Moonlight is the exception: one crystal adds damage without consuming a gem.
  if (player.hero.id === "elementalist")
    return player.energy.crystal + action.stones.crystal <= 1;
  return true;
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
    if (total < 2 && !single) return -1e6;
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
