import { createBasicCard } from "./card.js";
export { Card, BasicCard, AttackCard, SpellCard, PoisonCard, ShieldCard, WeaknessCard, HolyLightCard, MagicBulletCard, ExclusiveCard, createBasicCard } from "./card.js";

import { CARD_NAMES } from "./card-labels.js";
export { CARD_NAMES, cardName } from "./card-labels.js";

export const ELEMENT_NAMES = {
  dark: "暗", water: "水", fire: "火", wind: "风", lightning: "雷", earth: "地", light: "光",
};

export const FATE_NAMES = { X: "血", J: "技", Y: "咏", H: "幻", S: "圣" };

export const ATTACKS = new Set([
  "darkStrike", "waterStrike", "fireStrike", "windStrike", "lightningStrike", "earthStrike",
]);

// [element, fate, card name, count]. Extracted from card/xingBei.js in v1.6.7.
const DECK_SPEC = [
  ["dark","S","darkStrike",4], ["dark","Y","darkStrike",2],
  ["water","X","waterStrike",4], ["water","J","waterStrike",4], ["water","Y","waterStrike",6], ["water","S","waterStrike",3], ["water","H","waterStrike",4],
  ["fire","H","fireStrike",5], ["fire","X","fireStrike",4], ["fire","J","fireStrike",4], ["fire","Y","fireStrike",4], ["fire","S","fireStrike",4],
  ["wind","H","windStrike",4], ["wind","X","windStrike",4], ["wind","J","windStrike",5], ["wind","Y","windStrike",5], ["wind","S","windStrike",3],
  ["lightning","H","lightningStrike",5], ["lightning","X","lightningStrike",4], ["lightning","J","lightningStrike",4], ["lightning","Y","lightningStrike",4], ["lightning","S","lightningStrike",4],
  ["earth","S","earthStrike",3], ["earth","J","earthStrike",5], ["earth","X","earthStrike",5], ["earth","Y","earthStrike",4], ["earth","H","earthStrike",4],
  ["light","H","holyLight",2], ["light","S","holyLight",3], ["light","X","holyLight",3], ["light","J","holyLight",3],
  ["water","Y","weakness",1], ["water","X","weakness",1], ["fire","X","weakness",1], ["fire","S","weakness",1], ["earth","J","weakness",1], ["wind","H","weakness",1],
  ["water","H","poison",1], ["water","J","poison",1], ["water","S","poison",1], ["earth","Y","poison",1], ["wind","S","poison",1], ["lightning","J","poison",1],
  ["fire","X","holyShield",1], ["fire","J","holyShield",1], ["earth","H","holyShield",1], ["earth","Y","holyShield",1], ["earth","S","holyShield",1], ["wind","X","holyShield",1], ["wind","Y","holyShield",1], ["wind","S","holyShield",1], ["lightning","X","holyShield",1], ["lightning","H","holyShield",1],
  ["water","H","magicBullet",1], ["water","X","magicBullet",1], ["fire","Y","magicBullet",1], ["wind","H","magicBullet",1], ["lightning","J","magicBullet",1], ["lightning","S","magicBullet",1],
];

export function createDeck() {
  const deck = [];
  let id = 1;
  for (const [element, fate, name, count] of DECK_SPEC) {
    for (let i = 0; i < count; i++) deck.push(createBasicCard({ id: `c${id++}`, name, element, fate }));
  }
  return deck;
}

export function cardText(card) {
  return `${CARD_NAMES[card.name] ?? card.name}(${card.getTraits().elements.map(element => ELEMENT_NAMES[element]).join("/") || "无属性"}/${card.getTraits().fates.map(fate => FATE_NAMES[fate]).join("/") || "无命格"})`;
}

export function compareHandCards(a, b) {
  return Number(a.type !== "attack") - Number(b.type !== "attack")
    || (a.element ?? "").localeCompare(b.element ?? "") || (a.fate ?? "").localeCompare(b.fate ?? "");
}
