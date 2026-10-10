import { Game } from "../src/engine.js";

export const sceneNames = {
  opening: "六人开局", "hand-0": "零张手牌", "hand-1": "一张手牌", "hand-4": "四张手牌", "hand-6": "六张手牌",
  target: "选牌与目标", unusable: "不可主动使用的牌", purchase: "购买", synthesize: "合成材料", refine: "提炼材料",
  attack: "应战链", "attack-switch": "应战切牌", magic: "魔弹响应", "magic-start": "魔弹发起", "magic-linked": "六人魔弹传递", weakness: "虚弱", statuses: "状态标记", overflow: "爆牌", end: "结束",
};

export function createScene(id, seed = 20260905) {
  const game = new Game({ seed }).setup();
  const player = game.player(0);
  // Move actual card instances between zones; never invent or duplicate a card.
  const returnHand = member => { for (const card of [...member.hand]) game.moveCard(card.id, { zone: "deck" }); };
  returnHand(player);
  const take = (name, element, fate) => {
    const index = game.deck.findIndex(card => card.name === name && (!element || card.element === element) && (!fate || card.fate === fate));
    if (index < 0) throw new Error(`场景缺少牌：${name}`);
    game.moveCard(game.deck[index].id, { zone: "hand", playerId: player.id });
  };
  take("weakness", "water", "X"); take("earthStrike", "earth", "J"); take("weakness", "fire", "S"); take("windStrike", "wind", "X");
  const handSize = id.startsWith("hand-") ? Number(id.slice(5)) : id === "purchase" || id === "synthesize" ? 3 : id === "overflow" ? 8 : 4;
  if (handSize < player.hand.length) for (const card of player.hand.slice(handSize)) game.moveCard(card.id, { zone: "deck" });
  if (handSize > player.hand.length) game.draw(0, handSize - player.hand.length, { overflow: "defer" });
  if (["synthesize", "refine"].includes(id)) game.teams.red.achievements.push("gem", "gem", "crystal", "crystal");
  const statusCard = name => {
    const index = game.deck.findIndex(card => card.name === name);
    return game.deck[index];
  };
  if (id === "statuses") {
    const other = game.player(3);
    for (const name of ["holyShield", "weakness", "poison"]) game.attachCard(statusCard(name).id, other.id, { effectId: name, sourcePlayerId: 0 });
    player.energy = { gem: 1, crystal: 1 };
  }
  if (id === "weakness") game.attachCard(statusCard("weakness").id, player.id, { effectId: "weakness", sourcePlayerId: 1 });
  if (id === "unusable") {
    returnHand(player);
    take("holyLight"); take("holyLight"); take("earthStrike"); take("windStrike");
  }
  if (id === "magic") {
    returnHand(player);
    take("magicBullet"); take("holyLight"); take("earthStrike"); take("windStrike");
  }
  if (id === "attack-switch") {
    returnHand(player);
    take("earthStrike", "earth", "J"); take("earthStrike", "earth", "S"); take("windStrike"); take("holyLight");
  }
  if (["magic", "attack", "attack-switch"].includes(id)) {
    const opponent = game.player(id === "magic" ? 5 : 1);
    returnHand(opponent);
    const name = id === "magic" ? "magicBullet" : "earthStrike";
    const index = game.deck.findIndex(card => card.name === name);
    game.moveCard(game.deck[index].id, { zone: "hand", playerId: opponent.id });
    game.current = opponent.id;
  }
  if (["magic-start", "magic-linked"].includes(id)) {
    for (const member of game.players) returnHand(member);
    take("magicBullet"); take("holyLight");
    if (id === "magic-linked") {
      for (const member of game.players) {
        const index = member.id;
        if (index > 0) {
          const cardIndex = game.deck.findIndex(card => card.name === "magicBullet");
          game.moveCard(game.deck[cardIndex].id, { zone: "hand", playerId: member.id });
        }
      }
      game.current = 5;
    }
  }
  if (id === "end") { game.teams.red.cups = 5; game.winner = "red"; }
  game.assertCardLocations();
  game.log = [];
  return game;
}
