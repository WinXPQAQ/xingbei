import { Game } from "../src/engine.js";
export function createHeroScene(id, seed) {
  const heroId = id.slice(5);
  const game = new Game({ seed, heroIds: [heroId, "bard", "bard", "swordEmperor", "bard", "bard"] });
  const give = (playerId, predicate) => game.moveCard(game.deck.find(predicate).id, { zone: "hand", playerId });
  if (heroId === "berserker") {
    give(0, card => card.hasUniqueSkill("bloodyRoar"));
    give(0, card => card.hasUniqueSkill("bloodBlade"));
    give(1, card => card.name === "holyLight"); game.changeHealing(1, 2);
    const shield = game.deck.find(card => card.name === "holyShield"); game.attachCard(shield.id, 1, { effectId: "holyShield" });
    game.player(0).energy.gem = 1;
  }
  if (heroId === "windSwordmaster") {
    give(0, card => card.type === "attack" && card.hasUniqueSkill("galeArt"));
    give(0, card => card.type === "attack" && card.element === "wind");
    give(0, card => card.type === "attack" && card.element === "earth");
    game.player(0).energy.crystal = 1;
  }
  if (heroId === "marksman") {
    give(0, card => card.hasUniqueSkill("flashTrap"));
    give(0, card => card.name === "holyLight");
    game.player(0).handLimit = 4; game.player(0).energy.crystal = 1;
  }
  if (heroId === "sealer") {
    give(0, card => card.hasUniqueSkill("fireSeal")); give(0, card => card.name === "holyLight");
    give(1, card => card.name === "fireStrike"); game.player(0).energy.crystal = 2;
  }
  if (heroId === "guardianAngel") {
    give(0, card => card.hasUniqueSkill("angelWall")); give(0, card => card.element === "wind");
    const poison = game.deck.find(card => card.name === "poison"); game.attachCard(poison.id, 1, { effectId: "poison" });
  }
  if (heroId === "priest") {
    give(0, card => card.name === "holyLight"); give(0, card => card.name === "poison");
    give(0, card => card.name === "fireStrike"); game.changeHealing(0, 4); game.player(0).energy.crystal = 1;
  }
  if (["saint", "holyLancer", "plagueMage", "elementalist", "valkyrie", "magicalGirl"].includes(heroId)) {
    give(0, card => card.type === "attack" && card.element === "water");
    give(0, card => card.type === "attack" && card.element === "fire");
    give(0, card => card.name === "magicBullet");
    game.player(0).energy.gem = 1; game.player(0).energy.crystal = 1;
    game.changeHealing(0, 2);
    if (heroId === "elementalist") game.player(0).hero.state.elements = 3;
  }
  if (heroId === "assassin") {
    give(0, card => card.element === "water" && card.type === "attack");
    give(0, card => card.element === "water" && card.type === "attack");
    give(0, card => card.name === "holyLight");
    give(0, card => card.element === "fire" && card.type === "attack");
    game.player(0).energy.gem = 2;
  }
  if (heroId === "magicSwordsman") {
    give(0, card => card.element === "fire" && card.type === "attack");
    give(0, card => card.element === "fire" && card.type === "attack");
    give(0, card => card.name === "poison");
    give(0, card => card.name === "weakness");
    game.player(0).energy.gem = 1;
  }
  if (heroId === "adjudicator") {
    give(0, card => card.name === "fireStrike");
    give(0, card => card.name === "magicBullet");
    game.player(0).hero.state.judgment = 3;
    game.player(0).energy = { gem: 1, crystal: 1 };
  }
  if (heroId === "sage") {
    for (const element of ["earth", "earth", "water", "fire"])
      give(0, card => card.element === element && card.type === "attack");
    game.player(0).energy.gem = 2;
  }
  if (heroId === "prayer") {
    give(0, card => card.hasUniqueSkill("powerBlessing"));
    give(0, card => card.hasUniqueSkill("speedBlessing"));
    give(0, card => card.name === "fireStrike");
    game.player(0).hero.state.form = "prayer";
    game.player(0).hero.state.prayerRunes = 2;
    game.player(0).energy.crystal = 2;
  }
  if (heroId === "heroicPuppet") {
    for (const element of ["fire", "fire", "fire", "water", "water", "earth"])
      give(0, card => card.element === element && card.type === "attack");
    game.player(0).hero.state.battleRunes = 2;
    game.player(0).hero.state.magicRunes = 1;
    game.player(0).energy = { gem: 1, crystal: 2 };
  }
  game.log = []; game.assertCardLocations(); return game;
}


// Regression fixtures for a skill-generated magic chain; all cards are real entities.
export function createMagicFusionScene(id, seed) {
  const humanResponds = id === "magic-fusion-human";
  const actorId = humanResponds ? 1 : 0, targetId = humanResponds ? 0 : 1;
  const heroes = ["bard", "bard", "bard", "swordEmperor", "bard", "bard"];
  heroes[actorId] = "magicalGirl"; heroes[targetId] = "elementalist";
  const game = new Game({ seed, heroIds: heroes });
  const give = (playerId, predicate) => game.moveCard(game.deck.find(predicate).id, { zone: "hand", playerId });
  give(actorId, card => card.type === "attack" && card.element === "fire");
  give(targetId, card => card.name === "holyLight");
  for (let i = 0; i < 5; i++) give(targetId, card => card.type === "attack" && card.element === "water");
  game.current = actorId;
  game.log = []; game.assertCardLocations(); return game;
}
