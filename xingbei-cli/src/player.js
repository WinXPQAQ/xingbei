export class Player {
  constructor({ id, name, team, hero }) {
    this.id = id; this.name = name; this.team = team; this.hero = hero;
    this.hand = []; this.statuses = []; this.handLimit = 6;
    this.healing = 0; this.energy = { gem: 0, crystal: 0 };
  }
  get handLimit() { return this.hero.getSkills().reduce((limit, skill) => skill.modifyHandLimit?.(limit, this) ?? limit, this._handLimit); }
  set handLimit(value) { this._handLimit = value; }
  getBasicEffects() { return this.statuses.filter(card => card.category === "basic"); }
  getStatus(effectId) { return this.statuses.filter(card => card.attachment?.effectId === effectId); }
  getSkills(context = {}) {
    return [
      ...this.hero.getSkills(context).map(skill => ({ skill, sourceCard: null })),
      ...this.statuses.flatMap(card => card.skills.map(skill => ({ skill, sourceCard: card }))),
    ];
  }
  toJSON() {
    return { id: this.id, name: this.name, team: this.team, hero: this.hero, hand: this.hand,
      statuses: this.statuses, handLimit: this.handLimit,
      healing: this.healing, energy: this.energy, ...(this.pendingOverflow ? { pendingOverflow: this.pendingOverflow } : {}) };
  }
}
