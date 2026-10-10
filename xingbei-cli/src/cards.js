export const CARD_NAMES = {
  anMie: "暗灭", shuiLianZhan: "水涟斩", huoYanZhan: "火焰斩",
  fengShenZhan: "风神斩", leiGuangZhan: "雷光斩", diLieZhan: "地裂斩",
  shengGuang: "圣光", shengDun: "圣盾", xuRuo: "虚弱",
  zhongDu: "中毒", moDan: "魔弹",
};

export const ELEMENT_NAMES = {
  an: "暗", shui: "水", huo: "火", feng: "风", lei: "雷", di: "地", guang: "光",
};

export const FATE_NAMES = { xue: "血", ji: "技", yong: "咏", huan: "幻", sheng: "圣" };

export const ATTACKS = new Set([
  "anMie", "shuiLianZhan", "huoYanZhan", "fengShenZhan", "leiGuangZhan", "diLieZhan",
]);

// [element, fate, card name, count]. Extracted from card/xingBei.js in v1.6.7.
const DECK_SPEC = [
  ["an","sheng","anMie",4], ["an","yong","anMie",2],
  ["shui","xue","shuiLianZhan",4], ["shui","ji","shuiLianZhan",4], ["shui","yong","shuiLianZhan",6], ["shui","sheng","shuiLianZhan",3], ["shui","huan","shuiLianZhan",4],
  ["huo","huan","huoYanZhan",5], ["huo","xue","huoYanZhan",4], ["huo","ji","huoYanZhan",4], ["huo","yong","huoYanZhan",4], ["huo","sheng","huoYanZhan",4],
  ["feng","huan","fengShenZhan",4], ["feng","xue","fengShenZhan",4], ["feng","ji","fengShenZhan",5], ["feng","yong","fengShenZhan",5], ["feng","sheng","fengShenZhan",3],
  ["lei","huan","leiGuangZhan",5], ["lei","xue","leiGuangZhan",4], ["lei","ji","leiGuangZhan",4], ["lei","yong","leiGuangZhan",4], ["lei","sheng","leiGuangZhan",4],
  ["di","sheng","diLieZhan",3], ["di","ji","diLieZhan",5], ["di","xue","diLieZhan",5], ["di","yong","diLieZhan",4], ["di","huan","diLieZhan",4],
  ["guang","huan","shengGuang",2], ["guang","sheng","shengGuang",3], ["guang","xue","shengGuang",3], ["guang","ji","shengGuang",3],
  ["shui","yong","xuRuo",1], ["shui","xue","xuRuo",1], ["huo","xue","xuRuo",1], ["huo","sheng","xuRuo",1], ["di","ji","xuRuo",1], ["feng","huan","xuRuo",1],
  ["shui","huan","zhongDu",1], ["shui","ji","zhongDu",1], ["shui","sheng","zhongDu",1], ["di","yong","zhongDu",1], ["feng","sheng","zhongDu",1], ["lei","ji","zhongDu",1],
  ["huo","xue","shengDun",1], ["huo","ji","shengDun",1], ["di","huan","shengDun",1], ["di","yong","shengDun",1], ["di","sheng","shengDun",1], ["feng","xue","shengDun",1], ["feng","yong","shengDun",1], ["feng","sheng","shengDun",1], ["lei","xue","shengDun",1], ["lei","huan","shengDun",1],
  ["shui","huan","moDan",1], ["shui","xue","moDan",1], ["huo","yong","moDan",1], ["feng","huan","moDan",1], ["lei","ji","moDan",1], ["lei","sheng","moDan",1],
];

export function createDeck() {
  const deck = [];
  let id = 1;
  for (const [element, fate, name, count] of DECK_SPEC) {
    for (let i = 0; i < count; i++) deck.push({ id: `c${id++}`, name, element, fate });
  }
  return deck;
}

export function cardText(card) {
  return `${CARD_NAMES[card.name]}(${ELEMENT_NAMES[card.element]}/${FATE_NAMES[card.fate]})`;
}

export function compareHandCards(a, b) {
  return Number(!ATTACKS.has(a.name)) - Number(!ATTACKS.has(b.name))
    || a.element.localeCompare(b.element) || a.fate.localeCompare(b.fate);
}

export function cardName(cardOrName) {
  const name = typeof cardOrName === "string" ? cardOrName : cardOrName.name;
  return `【${CARD_NAMES[name] ?? name}】`;
}
