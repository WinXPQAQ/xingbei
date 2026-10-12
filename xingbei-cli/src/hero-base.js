// Hero instances own their skills/state; common bindings and predicates live here.
export class Hero {
  constructor({ id, name, portrait = id, skills = [] }) {
    this.id = id; this.name = name; this.portrait = portrait;
    this.skills = skills; this.state = {};
    // Explicit overrides remain available; Game also checks currently legal action skills.
    this.canActWithSkills = false;
  }
  get skills() { return this._skills; }
  set skills(skills) { this._skills = Object.freeze([...skills]); this.onSkillsChanged?.(); }
  addSkills(...skills) { this.skills = [...this.skills, ...skills]; }
  removeSkill(id) { this.skills = this.skills.filter(skill => (typeof skill === "string" ? skill : skill.id) !== id); }
  bind(role, timings, players = "self", damageTypes = null) {
    return { timings, bindings: [{ role, players, ...(damageTypes ? { damageTypes } : {}) }] };
  }
  onOwnAttack(timings) { return this.bind("actor", timings); }
  onOwnTurn(timings) { return this.bind("player", timings); }
  onDamage(timings, role, damageTypes = ["attack", "spell"]) { return this.bind(role, timings, "self", damageTypes); }
  isOwnAttack({ player, context }) { return context.actorId === player.id; }
  isActiveAttack(context) { return context.card?.type === "attack" && context.isCounter === false; }
  isCounterAttack(context) { return context.card?.type === "attack" && context.isCounter === true; }
  hasUniqueSkill(context, id) { return context.card?.hasUniqueSkill(id) ?? false; }
  isAttackAction(context) { return context.actionType === "attack"; }
  getSkills() { return [...this.skills]; }
  toJSON() { return { id: this.id, name: this.name, portrait: this.portrait, state: this.state, implemented: this.skills.length > 0, skillNames: this.skills.map(skill => skill.name ?? skill), canActWithSkills: this.canActWithSkills }; }
}
