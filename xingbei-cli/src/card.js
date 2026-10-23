import { Timing } from "./timing.js";
import { attackSteps } from "./resolution/attack.js";
import { magicSteps } from "./resolution/magic.js";
import { RuleError } from "./errors.js";
import { BASIC_EFFECTS } from "./effects.js";

export class Card {
  #location = null;
  constructor({ id, name, elements = [], fates = [], skills = [], uniqueSkills = [] }) {
    if (!id || !name) throw new RuleError("牌必须有唯一编号和牌名");
    Object.defineProperty(this, "id", { value: id, enumerable: true });
    this.name = name;
    Object.defineProperties(this, {
      elements: { value: Object.freeze([...elements]), enumerable: true },
      fates: { value: Object.freeze([...fates]), enumerable: true },
    });
    this.discardVisibility = null;
    this.uniqueSkills = Object.freeze([...uniqueSkills]);
    this.attachment = null; this.skills = Object.freeze([...skills]);
    this.category = "exclusive"; this.type = null;
  }
  get location() { return this.#location; }
  // Called only by Game.registerCard()/moveCard(); consumers query location.
  setLocation(location) { this.#location = Object.freeze({ ...location }); }
  get element() { return this.elements[0] ?? null; }
  get fate() { return this.fates[0] ?? null; }
  getPrintedTraits() { return { elements: [...this.elements], fates: [...this.fates] }; }
  getTraits(context = {}) {
    return context.game ? context.game.modifyTraits(this, this.getPrintedTraits(), context) : this.getPrintedTraits();
  }
  hasUniqueSkill(id) { return this.uniqueSkills.includes(id); }
  legalTargets() { return []; }
  canRespond() { return false; }
  resolve() { throw new RuleError(`尚未实现 ${this.name}`); }
  toJSON() {
    return { id: this.id, name: this.name, category: this.category, type: this.type,
      element: this.element, fate: this.fate, elements: this.elements, fates: this.fates,
      uniqueSkills: this.uniqueSkills, location: this.location, discardVisibility: this.discardVisibility, attachment: this.attachment };
  }
}

export class BasicCard extends Card {
  constructor({ element, fate, ...options }) {
    super({ ...options, elements: [element], fates: [fate] });
    if (!["dark", "water", "fire", "wind", "thunder", "earth", "light"].includes(element) || !["H", "Y", "J", "S", "X"].includes(fate)) throw new RuleError("基础牌必须有合法属性和命格");
    this.category = "basic";
  }
}
export class AttackCard extends BasicCard {
  constructor(options) { super(options); this.type = "attack"; }
  legalTargets({ game, actor }) { return game.players.filter(player => player.team !== actor.team).map(player => player.id); }
  canRespond(response, context = {}) {
    if (response.name === "holyLight") return true;
    if (response.type !== "attack" || this.name === "darkStrike") return false;
    const attackTraits = context.attackTraits ?? this.getTraits({ ...context, playerId: context.actorId, purpose: "attack" });
    const responseTraits = response.getTraits({ ...context, playerId: context.targetId, purpose: "response" });
    return response.name === "darkStrike" || attackTraits.elements.some(element => responseTraits.elements.includes(element));
  }
  resolve({ game, actor, targetId, options }) { return attackSteps(game, actor.id, actor.hand.indexOf(this), targetId, options); }
}
export class SpellCard extends BasicCard {
  constructor(options) { super(options); this.type = "spell"; }
}
class EffectCard extends SpellCard {
  constructor(options, effectDefinition) {
    super(options);
    if (this.name !== effectDefinition.id) throw new RuleError("状态牌与其基础效果不匹配");
    Object.defineProperty(this, "effectDefinition", { value: effectDefinition });
  }
  legalTargets({ game }) { return game.players.filter(player => game.canAttach(this, player.id, this.effectDefinition.id)).map(player => player.id); }
  *resolve({ game, actor, targetId, options }) {
    game.playCard(actor, actor.hand.indexOf(this), options);
    game.attachCard(this.id, targetId, { effectId: this.effectDefinition.id, sourcePlayerId: actor.id });
    if (this.effectDefinition.id === "holyShield") yield* game.trigger(Timing.SHIELD_USED, { actorId: actor.id, targetId, card: this }, options);
  }
}
export class PoisonCard extends EffectCard {
  constructor(options) { super(options, BASIC_EFFECTS.poison); }
}
export class ShieldCard extends EffectCard {
  constructor(options) { super(options, BASIC_EFFECTS.holyShield); }
}
export class WeaknessCard extends EffectCard {
  constructor(options) { super(options, BASIC_EFFECTS.weakness); }
}
export class HolyLightCard extends SpellCard {
  resolve() { throw new RuleError("圣光只能用于响应攻击或魔弹"); }
}
export class MagicBulletCard extends SpellCard {
  legalTargets({ game, actor }) { return game.magicTargets(actor.id); }
  resolve({ game, actor, targetId, options }) {
    return magicSteps(game, actor.id, actor.hand.indexOf(this), { ...options, targetId });
  }
}
export class ExclusiveCard extends Card {
  constructor(options) { super(options); this.heroId = options.heroId ?? null; }
}

const spellClasses = { poison: PoisonCard, holyShield: ShieldCard, weakness: WeaknessCard, holyLight: HolyLightCard, magicBullet: MagicBulletCard };
export function createBasicCard(options) {
  const Type = spellClasses[options.name] || AttackCard;
  if (!spellClasses[options.name] && !["darkStrike", "waterStrike", "fireStrike", "windStrike", "thunderStrike", "earthStrike"].includes(options.name)) throw new RuleError(`未知基础牌 ${options.name}`);
  return new Type(options);
}
