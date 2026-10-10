export class Player {
  constructor({ id, name, team, hero }) {
    this.id = id; this.name = name; this.team = team; this.hero = hero;
    this.hand = []; this.statuses = [];
    this.healing = 0; this.energy = { gem: 0, crystal: 0 };
  }
  getBasicEffects() { return this.statuses.filter(card => card.category === "basic"); }
  getEffects(effectId) { return this.statuses.filter(card => card.attachment?.effectId === effectId); }
  get shield() { return this.getEffects("holyShield")[0] ?? null; }
  get weakness() { return this.getEffects("weakness")[0] ?? null; }
  get poisons() { return this.getEffects("poison"); }
  getSkills(context = {}) {
    return [
      ...this.hero.getSkills(context).map(skill => ({ skill, sourceCard: null })),
      ...this.statuses.flatMap(card => card.skills.map(skill => ({ skill, sourceCard: card }))),
    ];
  }
  toJSON() {
    return { id: this.id, name: this.name, team: this.team, hero: this.hero, hand: this.hand,
      statuses: this.statuses, shield: this.shield, weakness: this.weakness, poisons: this.poisons,
      healing: this.healing, energy: this.energy, ...(this.pendingOverflow ? { pendingOverflow: this.pendingOverflow } : {}) };
  }
}
