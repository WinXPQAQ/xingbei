import { Priest } from "./heroes/priest.js";
import { GuardianAngel } from "./heroes/guardian-angel.js";
import { Sealer } from "./heroes/sealer.js";
import { Marksman } from "./heroes/marksman.js";
import { WindSwordmaster } from "./heroes/wind-swordmaster.js";
import { Berserker } from "./heroes/berserker.js";
import { Hero } from "./hero-base.js";
export { Hero } from "./hero-base.js";
const definitions = [
  ["berserker", "狂战士"], ["magicalGirl", "魔法少女"], ["bard", "吟游诗人"],
  ["swordEmperor", "剑帝"], ["priest", "神官"], ["assassin", "暗杀者"],
];
export const HERO_DEFINITIONS = { priest: { name: "神官", HeroClass: Priest }, guardianAngel: { name: "守护天使", HeroClass: GuardianAngel }, sealer: { name: "封印师", HeroClass: Sealer }, marksman: { name: "神箭手", HeroClass: Marksman }, windSwordmaster: { name: "风之剑圣", HeroClass: WindSwordmaster }, berserker: { name: "狂战士", HeroClass: Berserker } };
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
export function createHeroRoster(playerHeroId, playerSeat = 0) {
  if (!Object.hasOwn(HERO_DEFINITIONS, playerHeroId)) throw new Error("角色尚未实现或不存在");
  if (!Number.isInteger(playerSeat) || playerSeat < 0 || playerSeat >= DEFAULT_HERO_IDS.length) throw new Error("无效的玩家座位");
  const roster = [...DEFAULT_HERO_IDS], previousSeat = roster.indexOf(playerHeroId);
  if (previousSeat >= 0) [roster[playerSeat], roster[previousSeat]] = [roster[previousSeat], roster[playerSeat]];
  else roster[playerSeat] = playerHeroId;
  return roster;
}
