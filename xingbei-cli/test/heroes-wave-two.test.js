import test from "node:test";
import assert from "node:assert/strict";
import { Game, Timing } from "../src/engine.js";
import { resolveSync } from "../src/resolution/decisions.js";
import { getAvailableHeroes } from "../src/hero.js";
const make = (hero) =>
  new Game({
    seed: 27,
    shuffleDeck: false,
    heroIds: [hero, "none", "none", "none", "none", "none"],
  });
const take = (g, id, predicate) => {
  const c = g.deck.find(predicate);
  assert.ok(c);
  g.moveCard(c.id, { zone: "hand", playerId: id });
  return c;
};
const decide = (r) => (r.type === "response" ? null : r.defaultValue);
function skill(g, id, cardIds = [], targetIds = [], mode, choose = decide) {
  return resolveSync(
    g.skillActionSteps(
      0,
      { type: "skill", skillId: id, cardIds, targetIds, mode },
      { overflow: "first", choose },
    ),
    choose,
  );
}
function start(g) {
  g.startTurn(0);
}
function damage(g, id, n, options = {}) {
  return g.damage(id, n, { sourceId: 0, damageType: "spell", ...options });
}

test("圣女：使用水/圣光才触发祷言，治疗术/治愈之光独有技与实体清理", () => {
  const g = make("saint");
  const c = take(
    g,
    0,
    (c) => c.hasUniqueSkill("healingArt") && c.name === "holyLight",
  );
  skill(g, "healingArt", [c.id], [1], undefined, (r) =>
    r.type === "playerChoice" ? 3 : decide(r),
  );
  assert.equal(g.player(1).healing, 2);
  assert.equal(g.player(3).healing, 1);
  assert.equal(c.location.zone, "discard");
  const water = take(g, 0, (c) => c.element === "water");
  g.discardCards(0, [water]);
  resolveSync(g.flushRuleEvents(), decide);
  assert.equal(g.player(0).healing, 0, "明弃水牌不触发祷言");
  const light = take(g, 0, (c) => c.hasUniqueSkill("healingLight"));
  skill(g, "healingLight", [light.id], [0, 2, 4]);
  assert.equal(g.player(2).healing, 1);
  assert.equal(g.player(4).healing, 1);
  g.assertCardLocations();
});
test("圣女：怜悯恒定手限、圣疗分配/回合限制/可放弃的额外法术", () => {
  const g = make("saint");
  g.player(0).energy = { gem: 1, crystal: 1 };
  start(g);
  skill(g, "holyCure", [], [1, 3], undefined, (r) =>
    r.skillId === "compassion"
      ? true
      : r.skillId === "holyCure" && r.choices?.some((c) => c.value === "spell")
        ? "spell"
        : decide(r),
  );
  assert.equal(g.player(0).handLimit, 7);
  g.player(0).handLimit = 4;
  assert.equal(g.player(0).handLimit, 7);
  assert.equal(g.player(1).healing + g.player(3).healing, 3);
  assert.equal(g.turn.nextAction().type, "spell");
  assert.ok(!g.legalSkillActions(0).some((s) => s.skillId === "holyCure"));
  g.skipExtraActions(0);
  g.endTurn(0);
  g.current = 0;
  start(g);
  assert.ok(g.legalSkillActions(0).some((s) => s.skillId === "holyCure"));
});
test("圣枪：动态治疗上限、辉耀/惩戒与圣光祈雨超上限及天枪禁用", () => {
  const g = make("holyLancer");
  assert.equal(g.getHealingLimit(0), 3);
  g.teams.blue.cups = 1;
  assert.equal(g.getHealingLimit(0), 2);
  const c = take(g, 0, (c) => c.element === "water");
  start(g);
  skill(g, "radiance", [c.id]);
  assert.ok(g.players.every((p) => p.healing === 1));
  assert.equal(g.turn.nextAction().type, "attack");
  g.skipExtraActions(0);
  g.endTurn(0);
  g.current = 0;
  start(g);
  g.player(0).energy.gem = 1;
  g.player(0).healing = 4;
  skill(g, "holyPrayer");
  assert.equal(g.player(0).healing, 5);
  assert.equal(g.turn.state.usedSkills.blockHeavenSpear, true);
  const h = make("holyLancer");
  h.player(1).healing = 2;
  const spell = take(h, 0, (c) => c.type === "spell");
  skill(h, "chastisement", [spell.id], [1]);
  assert.equal(h.player(1).healing, 1);
  assert.equal(h.player(0).healing, 1);
});
test("圣枪：天枪允许圣光、不允许应战，地枪在时点2且与圣击互斥", () => {
  const g = make("holyLancer");
  g.player(0).healing = 4;
  take(g, 0, (c) => c.name === "fireStrike");
  take(g, 1, (c) => c.name === "fireStrike");
  take(g, 1, (c) => c.name === "holyLight");
  let saw = false;
  resolveSync(g.actionSteps(0, 0, 1), (r) => {
    if (r.skillId === "heavenSpear") return true;
    if (r.type === "response") {
      saw = true;
      assert.deepEqual(
        r.valid.map((v) => v.card.name),
        ["holyLight"],
      );
      return null;
    }
    if (r.skillId === "earthSpear") {
      assert.equal(g.timeline.at(-1).timing, Timing.ATTACK_HIT);
      return 2;
    }
    if (r.skillId === "holyStrike") throw Error("不能同时发动圣击");
    return decide(r);
  });
  assert.ok(saw);
  assert.equal(g.player(0).healing, 0);
  assert.equal(g.player(1).hand.length, 6);
});
test("瘟疫：圣渎只限制攻击治疗，死亡之触不触发不朽，费用非法不结算", () => {
  const g = make("plagueMage");
  assert.equal(g.getHealingLimit(0), 5);
  g.player(0).healing = 3;
  damage(g, 0, 1, { damageType: "attack" });
  assert.equal(g.player(0).healing, 3);
  assert.equal(g.player(0).hand.length, 1);
  damage(g, 0, 1, { useHealing: 1 });
  assert.equal(g.player(0).healing, 2);
  const cards = [
    take(g, 0, (c) => c.element === "fire"),
    take(g, 0, (c) => c.element === "fire"),
  ];
  start(g);
  skill(
    g,
    "deathTouch",
    cards.map((c) => c.id),
    [1],
    "fire:2:2",
    (r) => {
      if (r.skillId === "immortality") throw Error("死亡之触不能发动不朽");
      return decide(r);
    },
  );
  assert.equal(g.player(1).hand.length, 1);
  assert.equal(g.player(0).healing, 0);
  assert.throws(() => skill(g, "deathTouch", [], [1], "fire:2:9"));
  g.assertCardLocations();
});
test("瘟疫：范围伤害包括队友，士气损失只在回合结束补一次治疗；胜利终止群伤", () => {
  const g = make("plagueMage");
  for (const p of g.players) p.handLimit = 1;
  take(g, 1, () => true);
  take(g, 2, () => true);
  const earth = take(g, 0, (c) => c.element === "earth");
  start(g);
  skill(g, "plague", [earth.id]);
  assert.equal(g.player(3).hand.length, 1);
  assert.equal(g.player(0).healing, 0);
  g.endTurn(0);
  assert.equal(g.player(0).healing, 1);
  const h = make("plagueMage");
  h.player(0).energy.gem = 1;
  h.teams.blue.morale = 1;
  h.player(1).handLimit = 0;
  skill(h, "toxicNova");
  assert.equal(h.winner, "red");
  assert.equal(h.player(2).hand.length, 0);
  assert.equal(h.player(0).healing, 0);
});
test("元素师：独有技加弃牌增伤、对应追加行动/治疗/星石与元素上限", () => {
  for (const [id, element, amount, extra] of [
    ["meteor", "earth", 2, "spell"],
    ["freeze", "water", 2, null],
    ["fireball", "fire", 3, null],
    ["windBlade", "wind", 2, "attack"],
    ["lightning", "thunder", 2, null],
  ]) {
    const g = make("elementalist"),
      c = take(g, 0, (c) => c.hasUniqueSkill(id)),
      cost = take(g, 0, (c) => c.element === element);
    start(g);
    skill(g, id, [c.id], [1], undefined, (r) =>
      r.type === "cardChoice"
        ? [0]
        : r.type === "skillChoice"
          ? true
          : r.type === "playerChoice"
            ? 3
            : decide(r),
    );
    assert.equal(g.player(1).hand.length, amount, id);
    assert.equal(cost.location.zone, "discard");
    assert.equal(g.player(0).hero.state.elements, 1);
    assert.equal(g.turn.nextAction()?.type ?? null, extra);
    if (id === "freeze") assert.equal(g.player(3).healing, 1);
    if (id === "lightning") assert.equal(g.stoneCounts("red").gem, 1);
    g.assertCardLocations();
  }
});
test("元素点燃消耗3元素且不吸收自身伤害，月光按支付后的能量计算", () => {
  const g = make("elementalist");
  g.player(0).hero.state.elements = 3;
  start(g);
  skill(g, "elementIgnition", [], [1], undefined, (r) => {
    if (r.skillId === "elementAbsorption") throw Error("点燃不能吸收");
    return decide(r);
  });
  assert.equal(g.player(0).hero.state.elements, 0);
  assert.equal(g.turn.nextAction().type, "spell");
  g.player(0).energy = { gem: 2, crystal: 1 };
  skill(g, "moonlight", [], [2], undefined, (r) =>
    r.type === "skillChoice" ? true : decide(r),
  );
  assert.equal(g.player(2).hand.length, 3);
  assert.equal(g.player(0).hero.state.elements, 1);
});
test("女武神：秩序摸牌是非伤害、神圣追击可放弃，英灵召唤及形态重置", () => {
  const g = make("valkyrie");
  start(g);
  skill(g, "orderSigil", [], [], undefined, (r) =>
    r.skillId === "divinePursuit" ? true : decide(r),
  );
  assert.equal(g.player(0).hand.length, 2);
  assert.equal(g.player(0).energy.crystal, 1);
  assert.equal(g.player(0).healing, 0);
  assert.equal(g.turn.nextAction().type, "attack");
  take(g, 0, (c) => c.type === "attack");
  const idx = g.player(0).hand.findIndex((c) => c.type === "attack");
  resolveSync(g.actionSteps(0, idx, 1), (r) =>
    r.type === "skillChoice" && r.skillId === "heroicSummon" ? true : decide(r),
  );
  assert.equal(g.player(0).hero.state.form, "英灵");
  g.endTurn(0);
  g.current = 0;
  start(g);
  assert.equal(g.player(0).healing, 1);
  assert.equal(g.player(0).hero.state.form, null);
  g.player(0).hero.state.form = "英灵";
  const card = take(g, 0, (c) => c.type === "attack");
  g.play(0, g.player(0).hand.indexOf(card), 1);
  assert.equal(g.player(0).hero.state.form, null);
});
test("女武神：军神威光最多支付2星石，英灵形态可以保持", () => {
  const g = make("valkyrie");
  g.player(0).hero.state.form = "英灵";
  g.addStones("red", "gem", 2);
  resolveSync(g.turn.start(0), (r) =>
    r.skillId === "warGodRadiance" && r.type === "playerChoice"
      ? 3
      : r.choices?.some((c) => c.value === "stones")
        ? "stones"
        : r.choices?.some((c) => c.value === "2:0")
          ? "2:0"
          : decide(r),
  );
  assert.equal(g.player(3).healing, 2);
  assert.equal(g.stoneCounts("red").total, 0);
  assert.equal(g.player(0).hero.state.form, "英灵");
});
test("魔法少女：主动魔弹选择方向，响应融合沿原方向，实体统一弃牌", () => {
  const g = make("magicalGirl");
  const magic = take(g, 0, (c) => c.name === "magicBullet");
  assert.deepEqual(g.legalTargets(0, magic), [1, 5]);
  g.play(0, 0, 5);
  assert.equal(g.player(5).hand.length, 2);
  assert.equal(g.player(1).hand.length, 0);
  g.assertCardLocations();
  const h = new Game({
    shuffleDeck: false,
    heroIds: ["none", "magicalGirl", "none", "none", "none", "none"],
  });
  take(h, 0, (c) => c.name === "magicBullet");
  const fire = take(h, 1, (c) => c.element === "fire");
  h.play(0, 0, 1, { responses: { 1: { index: 0, targetId: 3 } } });
  assert.equal(h.player(3).hand.length, 3);
  assert.equal(fire.location.zone, "discard");
  h.assertCardLocations();
  const f = make("magicalGirl");
  const earth = take(f, 0, (c) => c.element === "earth");
  skill(f, "magicFusion", [earth.id], [5]);
  assert.equal(f.player(5).hand.length, 2);
  assert.equal(earth.location.zone, "discard");
});
test("魔爆冲击分别选择明弃法术或受伤，施法者后续暗弃；毁灭风暴双目标", () => {
  const g = make("magicalGirl");
  const cost = take(g, 0, (c) => c.type === "spell");
  take(g, 0, (c) => c.type === "attack");
  const defender = take(g, 1, (c) => c.type === "spell");
  skill(g, "magicBurst", [cost.id], [1, 2], undefined, (r) =>
    r.type === "cardChoice" ? [0] : decide(r),
  );
  assert.equal(defender.discardVisibility, "public");
  assert.equal(g.player(2).hand.length, 2);
  assert.equal(g.player(0).hand.length, 0);
  assert.ok(g.discard.some((c) => c.discardVisibility === "hidden"));
  assert.equal(g.stoneCounts("red").gem, 1);
  const h = make("magicalGirl");
  h.player(0).energy.gem = 1;
  skill(h, "destructionStorm", [], [1, 5]);
  assert.equal(h.player(1).hand.length, 2);
  assert.equal(h.player(5).hand.length, 2);
  h.assertCardLocations();
});
