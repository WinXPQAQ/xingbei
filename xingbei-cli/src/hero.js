import { priestSkills } from "./heroes/priest.js";
import { guardianAngelSkills } from "./heroes/guardian-angel.js";
import { sealerSkills } from "./heroes/sealer.js";
import { marksmanSkills } from "./heroes/marksman.js";
import { windSwordmasterSkills } from "./heroes/wind-swordmaster.js";
import { berserkerSkills } from "./heroes/berserker.js";
// Fixed definitions are shared; mutable state belongs to each hero instance.
export class Hero {
  constructor({ id, name, portrait = id, skills = [] }) {
    this.id = id; this.name = name; this.portrait = portrait;
    this.skills = skills; this.state = {};
    // Explicit overrides remain available; Game also checks currently legal action skills.
    this.canActWithSkills = false;
  }
  getSkills() { return [...this.skills]; }
  toJSON() { return { id: this.id, name: this.name, portrait: this.portrait, state: this.state, implemented: this.skills.length > 0, skillNames: this.skills.map(skill => skill.name ?? skill), canActWithSkills: this.canActWithSkills }; }
}
const definitions = [
  ["berserker", "狂战士"], ["magicalGirl", "魔法少女"], ["bard", "吟游诗人"],
  ["swordEmperor", "剑帝"], ["priest", "神官"], ["assassin", "暗杀者"],
];
export const HERO_DEFINITIONS = { priest: { name: "神官", skills: priestSkills }, guardianAngel: { name: "守护天使", skills: guardianAngelSkills }, sealer: { name: "封印师", skills: sealerSkills }, marksman: { name: "神箭手", skills: marksmanSkills }, windSwordmaster: { name: "风之剑圣", skills: windSwordmasterSkills }, berserker: { name: "狂战士", skills: berserkerSkills } };
export function createHero(id, enabled = true) {
  const definition = HERO_DEFINITIONS[id];
  const name = definition?.name ?? definitions.find(entry => entry[0] === id)?.[1] ?? id;
  return new Hero({ id, name, skills: enabled ? definition?.skills ?? [] : [] });
}
export const DEFAULT_HERO_IDS = ["berserker", "windSwordmaster", "marksman", "sealer", "guardianAngel", "priest"];
export function createDefaultHero(seat, enabled = true) { return createHero(enabled ? DEFAULT_HERO_IDS[seat] : definitions[seat][0], enabled); }
