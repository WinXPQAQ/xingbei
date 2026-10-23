// Shared preparation value for skills which spend gems. Hero modules decide
// whether single stones and the first crystal have an actual use.
export function gemPreparation(g, id, action, { allowSingle = false, crystalBonus = false } = {}) {
  const p = g.player(id), { gem, crystal } = action.stones, total = gem + crystal;
  if (total < 2 && !allowSingle) return -12;
  let bonus = 0;
  for (let i = 0; i < gem; i++) bonus += p.energy.gem + i === 0 ? 26 : 6;
  if (crystalBonus && crystal && p.energy.crystal === 0 && p.energy.gem + gem > 0) bonus += 8;
  const stones = g.stoneCounts(p.team);
  if (g.teams[p.team].cups === 4 && stones.total >= 3 && stones.total - total < 3) bonus -= 30;
  return bonus;
}
