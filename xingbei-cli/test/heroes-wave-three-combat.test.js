import test from "node:test";
import assert from "node:assert/strict";
import { Game, Timing } from "../src/engine.js";
import { resolveSync } from "../src/resolution/decisions.js";

const make = (hero) => new Game({ seed: 43, shuffleDeck: false,
  heroIds: [hero, "none", "none", "none", "none", "none"] });
const take = (game, id, predicate) => {
  const card = game.deck.find(predicate);
  assert.ok(card);
  game.moveCard(card.id, { zone: "hand", playerId: id });
  return card;
};
const choice = (request) => request.type === "response" ? null : request.defaultValue;
const run = (steps, decide = choice) => resolveSync(steps, decide);
const skill = (g, id, cards, targetId, decide = choice) => run(g.skillActionSteps(0,
  { type: "skill", skillId: id, cardIds: cards.map((c) => c.id), targetIds: [targetId] },
  { overflow: "first" }), decide);

test("暗杀者：潜行在启动后降手限和加伤，只禁止应战/主动目标，下个行动阶段重置", () => {
  const g = make("assassin");
  const attack = take(g, 0, (c) => c.name === "fireStrike");
  take(g, 1, (c) => c.name === "fireStrike");
  take(g, 1, (c) => c.name === "holyLight");
  g.player(0).energy = { gem: 2, crystal: 1 };
  g.startTurn(0);
  let offeredResponse = false;
  run(g.actionSteps(0, g.player(0).hand.indexOf(attack), 1), (r) => {
    if (r.skillId === "stealth" && r.type === "skillChoice") return true;
    if (r.type === "response") {
      offeredResponse = true;
      assert.deepEqual(r.valid.map((e) => e.card.name), ["holyLight"]);
    }
    return choice(r);
  });
  assert.ok(offeredResponse, "潜行不跳过响应，圣光仍可抵挡");
  assert.equal(g.player(1).hand.length, 6, "剩余2能量使本次攻击为4伤害");
  assert.equal(g.player(0).handLimit, 5);
  assert.equal(g.canAttackTarget(1, 0), false);
  assert.equal(g.canAttackTarget(1, 0, true), true, "应战仍可指定潜行者");
  g.endTurn(0);
  g.current = 0;
  g.startTurn(0);
  assert.equal(g.player(0).hero.state.form, null);
  assert.equal(g.player(0).handLimit, 6);
  assert.equal(g.canAttackTarget(1, 0), true);
  g.assertCardLocations();
});

test("暗杀者：水影先明弃水再可弃法术，特殊摸牌不触发，反噬仅实际攻击伤害后摸牌", () => {
  const g = make("assassin");
  const water = take(g, 0, (c) => c.element === "water");
  const spell = take(g, 0, (c) => c.type === "spell" && c.element !== "water");
  g.player(0).hero.state.form = "潜行";
  run(g.drawSteps(0, 2, { overflow: "first" }), (r) => {
    if (r.skillId === "waterShadow" && r.type === "numberChoice") return 1;
    if (r.type === "cardChoice") return r.valid.slice(0, r.count);
    return choice(r);
  });
  assert.equal(water.discardVisibility, "public");
  assert.equal(spell.discardVisibility, "public");
  assert.equal(g.player(0).hand.length, 2);
  take(g, 0, (c) => c.element === "water");
  run(g.drawSteps(0, 1, { specialAction: true }), (r) => {
    assert.notEqual(r.skillId, "waterShadow");
    return choice(r);
  });
  g.player(0).healing = 1;
  const before = g.player(1).hand.length;
  run(g.damageSteps(0, 1, { sourceId: 1, damageType: "attack", useHealing: 1 }));
  assert.equal(g.player(1).hand.length, before, "被治疗完全抵挡不发动反噬");
  run(g.damageSteps(0, 1, { sourceId: 1, damageType: "spell", useHealing: 0 }));
  assert.equal(g.player(1).hand.length, before, "法术伤害不发动反噬");
  run(g.damageSteps(0, 1, { sourceId: 1, damageType: "attack", useHealing: 0 }));
  assert.equal(g.player(1).hand.length, before + 1);
  assert.ok(g.timeline.some((e) => e.timing === Timing.DRAW_BEFORE));
  g.assertCardLocations();
});

test("魔剑士：暗影启动、火系额外攻击和黄泉命中补手，禁法术只在自己的行动阶段", () => {
  const g = make("magicSwordsman");
  const attack = take(g, 0, (c) => c.name === "waterStrike");
  const fire = take(g, 0, (c) => c.name === "fireStrike");
  const light = take(g, 0, (c) => c.name === "holyLight");
  take(g, 1, (c) => c.name === "waterStrike");
  take(g, 1, (c) => c.name === "holyLight");
  g.player(0).energy.gem = 1;
  g.startTurn(0);
  assert.deepEqual(g.legalTargets(0, light), []);
  assert.equal(g.allowsCard(0, light, "response"), false);
  let paid = false;
  run(g.actionSteps(0, g.player(0).hand.indexOf(attack), 1), (r) => {
    if (r.type === "skillChoice" && ["shadowGathering", "hadesTremor", "asuraCombo"].includes(r.skillId)) return true;
    if (r.type === "response") {
      assert.deepEqual(r.valid.map((e) => e.card.name), ["holyLight"]);
      return null;
    }
    if (r.skillId === "hadesTremor" && r.type === "cardChoice") {
      paid = true;
      assert.equal(g.timeline.at(-1).timing, Timing.DRAW_BEFORE);
      assert.equal(g.player(0).hand.length, g.player(0).handLimit);
      return r.valid.filter((i) => g.player(0).hand[i].id !== fire.id).slice(0, 2);
    }
    return choice(r);
  });
  assert.ok(paid);
  assert.equal(g.player(0).hero.state.form, "暗影");
  assert.equal(g.player(0).hand.length, 4);
  assert.equal(g.player(1).hand.length, 5, "暗影所有攻击+1伤害");
  assert.equal(g.player(0).energy.gem, 0);
  assert.ok(g.discard.filter((c) => c.discardVisibility === "hidden").length >= 2);
  assert.deepEqual(g.turn.nextAction(), { type: "attack", element: "fire", sourceSkillId: "asuraCombo" });
  g.skipExtraActions(0);
  g.endTurn(0);
  assert.equal(g.allowsCard(0, light, "response"), true, "回合外仍可使用圣光");
  g.current = 0;
  g.startTurn(0);
  assert.equal(g.player(0).hero.state.form, null);
  g.assertCardLocations();
});

test("魔剑士：两法术可规划启动后暗影流星，费用明弃、两战绩重置、终局阻止后续", () => {
  const g = make("magicSwordsman");
  const cards = [take(g, 0, (c) => c.type === "spell"), take(g, 0, (c) => c.type === "spell")];
  g.addStones("red", "gem", 1);
  g.addStones("red", "crystal", 1);
  g.startTurn(0);
  assert.ok(g.legalSkillActions(0).some((s) => s.skillId === "shadowMeteor"));
  skill(g, "shadowMeteor", cards, 1, (r) => {
    if (r.skillId === "shadowGathering") return true;
    if (r.skillId === "shadowMeteor" && r.type === "numberChoice") return "1:1";
    return choice(r);
  });
  assert.ok(cards.every((c) => c.discardVisibility === "public"));
  assert.equal(g.player(1).hand.length, 2);
  assert.equal(g.player(0).hero.state.form, null);
  assert.equal(g.stoneCounts("red").total, 0);
  assert.equal(g.player(0).energy.gem, 1);
  g.assertCardLocations();
  const h = make("magicSwordsman");
  const payment = [take(h, 0, (c) => c.type === "spell"), take(h, 0, (c) => c.type === "spell")];
  h.player(0).hero.state.form = "暗影";
  h.player(1).handLimit = 0;
  h.teams.blue.morale = 1;
  h.addStones("red", "gem", 2);
  skill(h, "shadowMeteor", payment, 1, (r) => {
    assert.notEqual(r.skillId, "shadowMeteor", "获胜后不再询问重置费用");
    return choice(r);
  });
  assert.equal(h.winner, "red");
  assert.equal(h.stoneCounts("red").total, 2);
  assert.equal(h.player(0).energy.gem, 0);
  h.assertCardLocations();
});
