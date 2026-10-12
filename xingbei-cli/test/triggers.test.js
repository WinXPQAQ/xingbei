import test from "node:test";
import assert from "node:assert/strict";
import { Game, Timing } from "../src/engine.js";
import { Hero, createHero, DEFAULT_HERO_IDS } from "../src/hero.js";
import { ExclusiveCard } from "../src/card.js";
import { resolveSync } from "../src/resolution/decisions.js";

const trigger = (game, timing, context) => resolveSync(game.trigger(timing, context), request => request.defaultValue);
const empty = () => new Game({ heroRules: false, shuffleDeck: false });

test("六英雄继承基类并隔离实例；120个订阅槽只检查相关玩家、保留优先级与时点2子事件", () => {
  for (const id of DEFAULT_HERO_IDS) {
    const first = createHero(id), second = createHero(id);
    assert.ok(first instanceof Hero); assert.notEqual(first.constructor, Hero);
    first.state.changed = true;
    first.addSkills({ id: "extra" });
    assert.equal(second.state.changed, undefined);
    assert.equal(second.getSkills().some(skill => skill.id === "extra"), false);
  }
  const game = empty(), hero = game.player(0).hero;
  assert.equal(game.triggers.players.length, 6);
  assert.equal(game.triggers.players.reduce((count, slots) => count + slots.size, 0), 120);
  const attack = game.deck.find(card => card.type === "attack");
  assert.equal(hero.isActiveAttack({ card: attack, isCounter: false }), true);
  assert.equal(hero.isCounterAttack({ card: attack, isCounter: true }), true);
  assert.equal(hero.isActiveAttack({ card: attack, isCounter: true }), false);
  assert.equal(hero.isActiveAttack({ card: { type: "spell" }, isCounter: false }), false);
  const calls = [], filters = [];
  for (let id = 0; id < 6; id++) game.player(id).hero.addSkills({
    id: `own-${id}`, ...hero.onOwnAttack([Timing.ATTACK_DECLARED]),
    filter({ player }) { filters.push(player.id); return true; },
    resolve({ player }) { calls.push(`own-${player.id}`); },
  });
  game.player(5).hero.addSkills({
    id: "everyone", ...hero.bind("actor", [Timing.ATTACK_DECLARED], "all"), priority: 2,
    resolve({ player, context }) { calls.push(`owner-${player.id}/actor-${context.actorId}`); },
  });
  game.player(1).hero.addSkills({
    id: "defender", ...hero.bind("target", [Timing.ATTACK_DECLARED]), priority: 1,
    resolve() { calls.push("target"); },
  });
  trigger(game, Timing.ATTACK_DECLARED, { actorId: 0, targetId: 1 });
  assert.deepEqual(filters, [0]);
  assert.deepEqual(calls, ["owner-5/actor-0", "target", "own-0"]);
  calls.length = 0;
  game.player(0).hero.addSkills({
    id: "hit-only", ...hero.onOwnAttack([Timing.ATTACK_HIT]), resolve() { calls.push("hit"); },
  });
  for (const timing of [Timing.ATTACK_DECISION, Timing.ATTACK_HIT_CHECK]) trigger(game, timing, { actorId: 0, targetId: 1 });
  assert.deepEqual(calls, []);
  trigger(game, Timing.ATTACK_HIT, { actorId: 0, targetId: 1 });
  assert.deepEqual(calls, ["hit"]);
  calls.length = 0;
  game.player(5).hero.removeSkill("everyone");
  trigger(game, Timing.ATTACK_DECLARED, { actorId: 2, targetId: 1 });
  assert.deepEqual(calls, ["target", "own-2"]);
  calls.length = 0;
  game.player(0).hero.addSkills(
    { id: "low", ...hero.onOwnAttack([Timing.ATTACK_HIT]), priority: -2, resolve() { calls.push("low"); } },
    { id: "high", ...hero.onOwnAttack([Timing.ATTACK_HIT]), priority: 3, resolve() { calls.push("high"); } },
    { id: "same", ...hero.onOwnAttack([Timing.ATTACK_HIT]), resolve() { calls.push("same"); } },
  );
  trigger(game, Timing.ATTACK_HIT, { actorId: 0, targetId: 1 });
  assert.deepEqual(calls, ["high", "hit", "same", "low"]);
  calls.length = 0;
  game.player(0).hero.addSkills({
    id: "remove-low", ...hero.onOwnAttack([Timing.ATTACK_HIT]), priority: 4,
    resolve() { hero.removeSkill("low"); },
  });
  trigger(game, Timing.ATTACK_HIT, { actorId: 0, targetId: 1 });
  assert.deepEqual(calls, ["high", "hit", "same"]);
});

test("伤害3至6按造成/受到与类别分派；自伤双绑定去重、无来源与直接摸牌正确", () => {
  const game = empty(), calls = [];
  const timings = [Timing.DAMAGE_BEFORE, Timing.HEALING_BEFORE, Timing.DAMAGE_ACTUAL_BEFORE, Timing.DAMAGE_ACTUAL];
  game.player(0).hero.addSkills({
    id: "attack-source", ...game.player(0).hero.onDamage(timings, "actor", ["attack"]),
    resolve({ context }) { calls.push(`attack:${context.point}`); assert.equal(context.actorId, 0); },
  });
  game.player(1).hero.addSkills({
    id: "spell-target", ...game.player(1).hero.onDamage(timings, "target", ["spell"]),
    resolve({ context }) { calls.push(`spell:${context.point}`); },
  });
  game.damage(1, 0, { sourceId: 0, damageType: "attack" });
  assert.deepEqual(calls.splice(0), ["attack:3", "attack:4", "attack:5", "attack:6"]);
  game.damage(1, 0, { sourceId: 0, damageType: "spell" });
  assert.deepEqual(calls.splice(0), ["spell:3", "spell:4", "spell:5", "spell:6"]);
  game.damage(1, 0, { damageType: "spell" });
  assert.deepEqual(calls.splice(0), ["spell:3", "spell:4", "spell:5", "spell:6"]);
  game.draw(1, 1, { cause: { type: "directDraw" } });
  assert.deepEqual(calls, []);
  game.player(2).hero.addSkills({
    id: "both", timings: [Timing.DAMAGE_BEFORE], bindings: [{ role: "actor" }, { role: "target" }],
    resolve() { calls.push("once"); },
  });
  game.damage(2, 0, { sourceId: 2, damageType: "spell" });
  assert.deepEqual(calls, ["once"]);
});

test("状态牌与授予技能随移动注册注销；同名中毒保留独立实例，结算中移除立即失效", () => {
  const game = empty(), calls = [];
  game.registerEffect("marker", { timings: [] });
  const granted = { id: "granted", ...game.player(1).hero.onOwnAttack([Timing.ATTACK_DECLARED]), resolve() { calls.push("granted"); } };
  const card = new ExclusiveCard({ id: "grant-card", name: "grant", skills: [granted] });
  game.registerCard(card, { zone: "outside" });
  game.attachCard(card.id, 1, { effectId: "marker" });
  trigger(game, Timing.ATTACK_DECLARED, { actorId: 1, targetId: 0 });
  assert.deepEqual(calls.splice(0), ["granted"]);
  game.moveCard(card.id, { zone: "hand", playerId: 1 });
  trigger(game, Timing.ATTACK_DECLARED, { actorId: 1, targetId: 0 });
  assert.deepEqual(calls, []);
  game.attachCard(card.id, 2, { effectId: "marker" });
  game.player(2).hero.addSkills({
    id: "remove-first", ...game.player(2).hero.onOwnAttack([Timing.ATTACK_DECLARED]), priority: 2,
    resolve() { game.removeEffect(card.id, { zone: "outside" }); },
  });
  trigger(game, Timing.ATTACK_DECLARED, { actorId: 2, targetId: 0 });
  assert.deepEqual(calls, []);
  const poison = game.deck.filter(card => card.name === "poison").slice(0, 2);
  for (const card of poison) game.attachCard(card.id, 3, { effectId: "poison", sourcePlayerId: 0 });
  game.startTurn(3);
  assert.equal(game.player(3).hand.length, 2);
  assert.ok(poison.every(card => card.location.zone === "discard"));
  game.assertCardLocations();
});
