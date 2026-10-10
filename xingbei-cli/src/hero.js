// Fixed definitions are shared; mutable state belongs to each hero instance.
export class Hero {
  constructor({ id, name, portrait = id, skills = [] }) {
    this.id = id; this.name = name; this.portrait = portrait;
    this.skills = skills; this.state = {};
    // No hero action skills are implemented yet. Skills will update this flag.
    this.canActWithSkills = false;
  }
  getSkills() { return [...this.skills]; }
  toJSON() { return { id: this.id, name: this.name, portrait: this.portrait, state: this.state, canActWithSkills: this.canActWithSkills }; }
}
const definitions = [
  ["berserker", "狂战士"], ["magicalGirl", "魔法少女"], ["bard", "吟游诗人"],
  ["swordEmperor", "剑帝"], ["priest", "神官"], ["assassin", "暗杀者"],
];
export function createDefaultHero(seat) {
  const [id, name] = definitions[seat]; return new Hero({ id, name });
}
