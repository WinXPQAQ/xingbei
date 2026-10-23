import { HeroicPuppet } from "./heroes/heroic-puppet/index.js";
import { Prayer } from "./heroes/prayer/index.js";
import { Sage } from "./heroes/sage/index.js";
import { Adjudicator } from "./heroes/adjudicator/index.js";
import { MagicSwordsman } from "./heroes/magic-swordsman/index.js";
import { Assassin } from "./heroes/assassin/index.js";
import { Saint } from "./heroes/saint/index.js";
import { HolyLancer } from "./heroes/holy-lancer/index.js";
import { PlagueMage } from "./heroes/plague-mage/index.js";
import { Elementalist } from "./heroes/elementalist/index.js";
import { Valkyrie } from "./heroes/valkyrie/index.js";
import { MagicalGirl } from "./heroes/magical-girl/index.js";
import { Priest } from "./heroes/priest/index.js";
import { GuardianAngel } from "./heroes/guardian-angel/index.js";
import { Sealer } from "./heroes/sealer/index.js";
import { Marksman } from "./heroes/marksman/index.js";
import { WindSwordmaster } from "./heroes/wind-swordmaster/index.js";
import { Berserker } from "./heroes/berserker/index.js";
import { Hero } from "./hero-base.js";
export { Hero } from "./hero-base.js";
const definitions = [
  ["berserker", "狂战士"], ["magicalGirl", "魔法少女"], ["bard", "吟游诗人"],
  ["swordEmperor", "剑帝"], ["priest", "神官"], ["assassin", "暗杀者"],
];
export const HERO_DEFINITIONS = {
  assassin: { name: "暗杀者", HeroClass: Assassin },
  magicSwordsman: { name: "魔剑士", HeroClass: MagicSwordsman },
  adjudicator: { name: "仲裁者", HeroClass: Adjudicator },
  sage: { name: "贤者", HeroClass: Sage },
  prayer: { name: "祈祷师", HeroClass: Prayer },
  heroicPuppet: { name: "英灵人形", HeroClass: HeroicPuppet },
  saint: { name: "圣女", HeroClass: Saint },
  holyLancer: { name: "圣枪骑士", HeroClass: HolyLancer },
  plagueMage: { name: "瘟疫法师", HeroClass: PlagueMage },
  elementalist: { name: "元素师", HeroClass: Elementalist },
  valkyrie: { name: "女武神", HeroClass: Valkyrie },
  magicalGirl: { name: "魔法少女", HeroClass: MagicalGirl },
  priest: { name: "神官", HeroClass: Priest },
  guardianAngel: { name: "守护天使", HeroClass: GuardianAngel },
  sealer: { name: "封印师", HeroClass: Sealer },
  marksman: { name: "神箭手", HeroClass: Marksman },
  windSwordmaster: { name: "风之剑圣", HeroClass: WindSwordmaster },
  berserker: { name: "狂战士", HeroClass: Berserker },
};
export function createHero(id, enabled = true) {
  const definition = HERO_DEFINITIONS[id];
  const name = definition?.name ?? definitions.find(entry => entry[0] === id)?.[1] ?? id;
  return definition ? new definition.HeroClass(enabled) : new Hero({ id, name });
}
export const DEFAULT_HERO_IDS = ["berserker", "windSwordmaster", "marksman", "sealer", "guardianAngel", "priest"];
export function createDefaultHero(seat, enabled = true) { return createHero(enabled ? DEFAULT_HERO_IDS[seat] : definitions[seat][0], enabled); }

export function getAvailableHeroes() {
  const ids = [...new Set([...DEFAULT_HERO_IDS, ...Object.keys(HERO_DEFINITIONS)])];
  return ids.map(id => ({ id, name: HERO_DEFINITIONS[id].name }));
}
export const WAVE_THREE_HERO_IDS = ["assassin", "magicSwordsman", "adjudicator", "sage", "prayer", "heroicPuppet"];
export const WAVE_TWO_HERO_IDS = ["saint", "holyLancer", "plagueMage", "elementalist", "valkyrie", "magicalGirl"];
export function createHeroRoster(playerHeroId, playerSeat = 0, initialRoster = DEFAULT_HERO_IDS) {
  if (initialRoster.length !== 6 || initialRoster.some(id => !Object.hasOwn(HERO_DEFINITIONS, id))) throw new Error("无效的测试阵容");
  if (!Object.hasOwn(HERO_DEFINITIONS, playerHeroId)) throw new Error("角色尚未实现或不存在");
  if (!Number.isInteger(playerSeat) || playerSeat < 0 || playerSeat >= DEFAULT_HERO_IDS.length) throw new Error("无效的玩家座位");
  const roster = [...initialRoster], previousSeat = roster.indexOf(playerHeroId);
  if (previousSeat >= 0) [roster[playerSeat], roster[previousSeat]] = [roster[previousSeat], roster[playerSeat]];
  else roster[playerSeat] = playerHeroId;
  return roster;
}
