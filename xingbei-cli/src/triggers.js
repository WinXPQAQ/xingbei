import { Timing } from "./timing.js";

const attackPoints = new Map([
  [Timing.ATTACK_DECLARED, 1], [Timing.ATTACK_DECISION, 2],
  [Timing.ATTACK_HIT_CHECK, 2], [Timing.ATTACK_HIT, 2], [Timing.ATTACK_MISS, 2],
]);
const damagePoints = new Map([
  [Timing.DAMAGE_BEFORE, 3], [Timing.HEALING_BEFORE, 4],
  [Timing.DAMAGE_ACTUAL_BEFORE, 5], [Timing.DAMAGE_ACTUAL, 6], [Timing.DAMAGE_AFTER, 6],
]);
const key = (role, behavior, point) => `${role}:${behavior}:${point}`;

// Six player maps; each has 20 combat slots. Timing remains distinct inside a
// slot, especially decision/hit-check/hit at point 2 and actual/after at point 6.
export class TriggerRegistry {
  constructor(game) {
    this.game = game;
    this.players = game.players.map(() => {
      const slots = new Map();
      for (const role of ["actor", "target"]) {
        for (const point of [1, 2]) slots.set(key(role, "attack", point), new Map());
        for (const behavior of ["attackDamage", "spellDamage"]) {
          for (const point of [3, 4, 5, 6]) slots.set(key(role, behavior, point), new Map());
        }
      }
      return slots;
    });
    this.groups = new Map(); this.heroGroups = new Map(); this.sequence = 0;
  }

  unregister(group) {
    for (const { entry, set } of this.groups.get(group) ?? []) {
      entry.active = false; set.delete(entry);
    }
    this.groups.delete(group);
  }

  register(group, player, definition, source = {}) {
    if (!definition?.timings?.length) return;
    const entry = { player, definition, ...source, active: true, sequence: ++this.sequence };
    const references = this.groups.get(group) ?? [];
    this.groups.set(group, references);
    for (const timing of definition.timings) {
      const combat = attackPoints.has(timing) || damagePoints.has(timing);
      const defaultRole = attackPoints.has(timing) ? (source.card ? "target" : "actor") : damagePoints.has(timing) || timing === Timing.MAGIC_HIT_CHECK ? "target" : "player";
      const bindings = definition.bindings ?? [{ role: defaultRole, players: source.card ? "self" : "all" }];
      for (const binding of bindings) {
        if (binding.timings && !binding.timings.includes(timing)) continue;
        if (combat && !["actor", "target"].includes(binding.role)) throw new Error("攻击与伤害绑定必须指定actor或target");
        const ids = binding.players === "all" ? this.game.players.map(player => player.id)
          : binding.players === "team" ? this.game.players.filter(target => target.team === player.team).map(target => target.id)
          : Array.isArray(binding.players) ? binding.players : [player.id];
        const behaviors = damagePoints.has(timing) ? (binding.damageTypes ?? ["attack", "spell"]).map(type => `${type}Damage`)
          : [attackPoints.has(timing) ? "attack" : "event"];
        const point = attackPoints.get(timing) ?? damagePoints.get(timing) ?? 0;
        for (const id of ids) for (const behavior of behaviors) {
          const slots = this.players[id];
          if (!slots) throw new Error("无效的触发器绑定玩家");
          const slotKey = key(binding.role, behavior, point);
          if (!slots.has(slotKey)) slots.set(slotKey, new Map());
          const slot = slots.get(slotKey);
          if (!slot.has(timing)) slot.set(timing, new Set());
          const set = slot.get(timing); set.add(entry); references.push({ entry, set });
        }
      }
    }
  }

  registerHero(player) {
    const skills = player.hero.getSkills();
    const groups = this.heroGroups.get(player.id) ?? new Map();
    this.heroGroups.set(player.id, groups);
    const definitionOf = skill => typeof skill === "string" ? this.game.skillDefinitions.get(skill) : skill;
    for (const [skill, record] of groups) {
      if (!skills.includes(skill) || definitionOf(skill) !== record.definition) {
        this.unregister(record.group); groups.delete(skill);
      }
    }
    for (const skill of skills) {
      const definition = definitionOf(skill);
      if (!definition || groups.has(skill)) continue;
      const group = Symbol(`hero:${player.id}:${definition.id}`);
      groups.set(skill, { group, definition });
      this.register(group, player, definition);
    }
  }

  registerCard(card) {
    const group = `card:${card.id}`; this.unregister(group);
    if (card.location.zone !== "status") return;
    const player = this.game.player(card.location.playerId);
    this.register(group, player, this.game.effects.get(card.attachment.effectId), { card });
    for (const skill of card.skills) {
      this.register(group, player, typeof skill === "string" ? this.game.skillDefinitions.get(skill) : skill, { sourceCard: card });
    }
  }

  get(timing, context) {
    const entries = new Set();
    const read = (id, role, behavior, point) => {
      for (const entry of this.players[id]?.get(key(role, behavior, point))?.get(timing) ?? []) entries.add(entry);
    };
    const point = attackPoints.get(timing) ?? damagePoints.get(timing);
    if (point != null) {
      const behavior = attackPoints.has(timing) ? "attack" : `${context.damageType}Damage`;
      read(context.actorId ?? context.sourceId, "actor", behavior, point);
      read(context.targetId, "target", behavior, point);
    } else {
      read(context.actorId ?? context.sourceId, "actor", "event", 0);
      read(context.targetId, "target", "event", 0);
      read(context.playerId ?? context.targetId ?? context.actorId, "player", "event", 0);
      if (context.team) for (const player of this.game.players) {
        if (player.team === context.team) read(player.id, "team", "event", 0);
      }
    }
    return [...entries].sort((a, b) => (b.definition.priority ?? 0) - (a.definition.priority ?? 0)
      || Number(!!b.card) - Number(!!a.card) || a.player.id - b.player.id || a.sequence - b.sequence);
  }
}
