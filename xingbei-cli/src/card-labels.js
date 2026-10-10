export const CARD_NAMES = {
  darkStrike: "暗灭", waterStrike: "水涟斩", fireStrike: "火焰斩",
  windStrike: "风神斩", thunderStrike: "雷光斩", earthStrike: "地裂斩",
  holyLight: "圣光", holyShield: "圣盾", weakness: "虚弱",
  poison: "中毒", magicBullet: "魔弹",
};

export function cardName(cardOrName) {
  const name = typeof cardOrName === "string" ? cardOrName : cardOrName.name;
  return `【${CARD_NAMES[name] ?? name}】`;
}
