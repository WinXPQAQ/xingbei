import { Game } from "../src/engine.js";
export function createHeroScene(id, seed) {
  const heroId = id.slice(5);
  const game = new Game({ seed, heroIds: [heroId, "magicalGirl", "bard", "swordEmperor", "assassin", "magicalGirl"] });
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
  game.log = []; game.assertCardLocations(); return game;
}
