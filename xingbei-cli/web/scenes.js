import { Game } from "../src/engine.js";

export const sceneNames = {
  opening: "四人开局", "hand-0": "零张手牌", "hand-1": "一张手牌", "hand-4": "四张手牌", "hand-6": "六张手牌",
  target: "选牌与目标", unusable: "不可主动使用的牌", purchase: "购买", synthesize: "合成材料", refine: "提炼材料",
  attack: "应战链", magic: "魔弹响应", weakness: "虚弱", statuses: "状态标记", overflow: "爆牌", end: "结束",
};

export function createScene(id, seed = 20260905) {
  const game = new Game({ seed }).setup();
  const player = game.player(0);
  // Move actual card instances between zones; never invent or duplicate a card.
  game.deck.push(...player.hand.splice(0));
  const take = (name, element, fate) => {
    const index = game.deck.findIndex(card => card.name === name && (!element || card.element === element) && (!fate || card.fate === fate));
    if (index < 0) throw new Error(`场景缺少牌：${name}`);
    player.hand.push(game.deck.splice(index, 1)[0]);
  };
  take("xuRuo", "shui", "xue"); take("diLieZhan", "di", "ji"); take("xuRuo", "huo", "sheng"); take("fengShenZhan", "feng", "xue");
  const handSize = id.startsWith("hand-") ? Number(id.slice(5)) : id === "purchase" || id === "synthesize" ? 3 : id === "overflow" ? 8 : 4;
  if (handSize < player.hand.length) game.deck.push(...player.hand.splice(handSize));
  if (handSize > player.hand.length) game.draw(0, handSize - player.hand.length, { overflow: "defer" });
  if (["synthesize", "refine"].includes(id)) game.teams.red.achievements.push("gem", "gem", "crystal", "crystal");
  const statusCard = name => {
    const index = game.deck.findIndex(card => card.name === name);
    return game.deck.splice(index, 1)[0];
  };
  if (id === "statuses") {
    const other = game.player(2);
    other.shield = statusCard("shengDun"); other.weakness = statusCard("xuRuo"); other.poisons.push(statusCard("zhongDu"));
    player.energy = { gem: 1, crystal: 1 };
  }
  if (id === "weakness") player.weakness = statusCard("xuRuo");
  if (id === "unusable") {
    game.deck.push(...player.hand.splice(0));
    take("shengGuang"); take("shengGuang"); take("diLieZhan"); take("fengShenZhan");
  }
  if (id === "magic") {
    game.deck.push(...player.hand.splice(0));
    take("moDan"); take("shengGuang"); take("diLieZhan"); take("fengShenZhan");
  }
  if (["magic", "attack"].includes(id)) {
    const opponent = game.player(1);
    game.deck.push(...opponent.hand.splice(0));
    const name = id === "magic" ? "moDan" : "diLieZhan";
    const index = game.deck.findIndex(card => card.name === name);
    opponent.hand.push(game.deck.splice(index, 1)[0]);
    game.current = 1;
  }
  if (id === "end") { game.teams.red.cups = 5; game.winner = "red"; }
  game.log = [];
  return game;
}
