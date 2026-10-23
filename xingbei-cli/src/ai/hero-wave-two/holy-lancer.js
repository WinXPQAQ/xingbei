// Presence is public; future healing from these heroes makes Chastisement useful.
const healingHeroes = new Set([
  "guardianAngel",
  "priest",
  "saint",
  "holyLancer",
  "plagueMage",
  "valkyrie",
]);
export function enemyCanHeal(g, id) {
  const team = g.player(id).team;
  return g.players.some(
    (p) =>
      p.team !== team &&
      healingHeroes.has(p.hero.id) &&
      p.hero.skills.length > 0,
  );
}
export function radianceHealing(g, id) {
  const team = g.player(id).team;
  let own = 0,
    enemy = 0;
  for (const p of g.players) {
    const gain = Math.min(1, Math.max(0, g.getHealingLimit(p.id) - p.healing));
    if (p.team === team) own += gain;
    else enemy += gain;
  }
  return { own, enemy, allowed: own >= enemy };
}
