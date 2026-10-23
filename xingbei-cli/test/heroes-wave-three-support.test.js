import test from "node:test";
import assert from "node:assert/strict";
import { Game, Timing } from "../src/engine.js";
import { resolveSync } from "../src/resolution/decisions.js";

const make = (hero) => new Game({
  seed: 71, shuffleDeck: false, heroIds: [hero, "none", "none", "none", "none", "none"],
});
function take(game, playerId, filter = () => true) {
  const card = game.deck.find(filter);
  assert.ok(card);
  return game.moveCard(card.id, { zone: "hand", playerId });
}
const decide = (r) => r.type === "response" ? null : r.defaultValue;
function skill(game, skillId, cardIds = [], targetIds = [], choose = decide) {
  return resolveSync(game.skillActionSteps(0,
    { type: "skill", skillId, cardIds, targetIds }, { overflow: "first" }), choose);
}
function attack(game, actorId, card, targetId, choose = decide) {
  return resolveSync(game.actionSteps(actorId, game.player(actorId).hand.indexOf(card), targetId,
    { overflow: "first" }), choose);
}

test("祈祷师：赐福只贴队友、不叠加，牌承载效果可拒绝或在命中/行动结束消耗", () => {
  const g = make("prayer");
  const power = take(g, 0, (c) => c.hasUniqueSkill("powerBlessing"));
  const another = take(g, 0, (c) => c.hasUniqueSkill("powerBlessing"));
  const speed = take(g, 0, (c) => c.hasUniqueSkill("speedBlessing"));
  assert.throws(() => skill(g, "powerBlessing", [power.id], [0]), /目标/);
  skill(g, "powerBlessing", [power.id], [3]);
  skill(g, "speedBlessing", [speed.id], [3]);
  assert.throws(() => skill(g, "powerBlessing", [another.id], [3]), /目标/);
  assert.deepEqual(g.player(3).getBasicEffects().map((c) => c.id), [power.id, speed.id]);
  resolveSync(g.trigger(Timing.ATTACK_HIT, { actorId: 3, targetId: 1, hit: true, amount: 2 }), () => false);
  assert.equal(power.location.zone, "status", "拒绝发动不消耗基础效果");
  const card = take(g, 3, (c) => c.name === "fireStrike");
  g.current = 3;
  g.startTurn(3);
  attack(g, 3, card, 1, (r) => ["powerBlessing", "speedBlessing"].includes(r.skillId) ? true : decide(r));
  assert.equal(g.player(1).hand.length, 4);
  assert.equal(power.location.zone, "discard");
  assert.equal(speed.location.zone, "discard");
  assert.equal(g.turn.nextAction().sourceSkillId, "speedBlessing");
  assert.equal(g.turn.nextAction().type, "attack");
  g.skipExtraActions(3);
  g.endTurn();
  g.assertCardLocations();
});

test("祈祷师：启动/符文上限、暗弃信仰与每回合法术追加，诅咒胜利立即停止自伤", () => {
  const g = make("prayer"), p = g.player(0);
  p.energy = { gem: 1, crystal: 2 };
  const card = take(g, 0, (c) => c.name === "fireStrike");
  g.startTurn(0);
  attack(g, 0, card, 1, (r) => r.skillId === "prayer" ? true : decide(r));
  assert.equal(p.hero.state.form, "prayer");
  assert.equal(p.hero.state.prayerRunes, 2);
  resolveSync(g.trigger(Timing.ATTACK_DECLARED, { actorId: 0, targetId: 1, card, isCounter: false }), decide);
  assert.equal(p.hero.state.prayerRunes, 3);
  resolveSync(g.trigger(Timing.ATTACK_DECLARED, { actorId: 0, targetId: 1, card, isCounter: true }), decide);
  assert.equal(p.hero.state.prayerRunes, 3);
  g.endTurn();
  g.current = 0;
  g.startTurn(0);
  const costs = [take(g, 0), take(g, 0)];
  let tides = 0;
  const choose = (r) => {
    if (r.skillId === "manaTide") { tides++; return true; }
    return decide(r);
  };
  const stones = g.stoneCounts("red").gem;
  skill(g, "radiantFaith", [], [3], choose);
  assert.equal(g.stoneCounts("red").gem, stones + 1);
  assert.equal(g.player(3).healing, 1);
  assert.ok(costs.every((c) => c.discardVisibility === "hidden"));
  assert.equal(g.turn.nextAction().type, "spell");
  skill(g, "darkCurse", [], [1], choose);
  assert.equal(tides, 1);
  assert.equal(p.energy.crystal, 1);
  assert.equal(p.hero.state.prayerRunes, 1);
  assert.equal(p.hand.length, 2);
  assert.equal(g.player(1).hand.length, 4);
  g.assertCardLocations();

  const h = make("prayer");
  h.player(0).hero.state = { form: "prayer", prayerRunes: 1 };
  while (h.player(1).hand.length < 6) take(h, 1);
  h.teams.blue.morale = 1;
  skill(h, "darkCurse", [], [1]);
  assert.equal(h.winner, "red");
  assert.equal(h.player(0).hand.length, 0, "对手败北后不继续自伤");
  h.assertCardLocations();
});

test("英灵人形：改造/同系碎击/无士气回响共用伤害链，回合结束手限下降处理爆牌", () => {
  const g = make("heroicPuppet"), p = g.player(0);
  assert.deepEqual([p.hero.state.battleRunes, p.hero.state.magicRunes], [3, 0]);
  p.energy = { gem: 1, crystal: 2 };
  const card = take(g, 0, (c) => c.name === "fireStrike");
  take(g, 0, (c) => c.element === "fire");
  take(g, 0, (c) => c.element === "fire");
  for (const id of [1, 2]) while (g.player(id).hand.length < 6) take(g, id);
  let echoes = 0;
  const choose = (r) => {
    if (r.type === "skillChoice" && r.skillId === "runeReconstruction") return true;
    if (r.type === "numberChoice" && r.skillId === "runeReconstruction") return 3;
    if (r.type === "cardChoice" && r.skillId === "battleRuneStrike") return r.validSets.find((set) => set.length === 2);
    if (r.type === "numberChoice" && r.skillId === "battleRuneStrike") return 2;
    if (r.type === "skillChoice" && r.skillId === "doubleEcho") { echoes++; return true; }
    if (r.type === "playerChoice" && r.skillId === "doubleEcho") return 2;
    return decide(r);
  };
  g.startTurn(0);
  attack(g, 0, card, 1, choose);
  assert.equal(p.hero.state.form, "runeBurst");
  assert.equal(p.handLimit, 7);
  assert.deepEqual([p.hero.state.battleRunes, p.hero.state.magicRunes], [0, 3]);
  assert.equal(g.teams.blue.morale, 10, "主攻击5伤掉5士气，回响3伤不掉士气");
  assert.equal(echoes, 1, "回响不递归");
  assert.equal(p.energy.crystal, 1);
  resolveSync(g.damageSteps(2, 1, { sourceId: 0, damageType: "spell", overflow: "first" }), choose);
  assert.equal(echoes, 1, "同一回合不可再次回响");
  while (p.hand.length < 7) take(g, 0);
  g.endTurn({ overflow: "first" });
  assert.equal(p.hero.state.form, null);
  assert.equal(p.handLimit, 6);
  assert.equal(p.hand.length, 6);
  assert.equal(g.teams.red.morale, 14);
  g.assertCardLocations();
});

test("英灵人形：未命中异系融合与怒火压制互斥，翻转总量恒为3", () => {
  for (const convert of [false, true]) {
    const g = make("heroicPuppet"), p = g.player(0);
    p.hero.state.battleRunes = 2;
    p.hero.state.magicRunes = 1;
    const card = take(g, 0, (c) => c.name === "fireStrike");
    take(g, 0, (c) => c.element === "water");
    take(g, 0, (c) => c.element === "earth");
    const light = take(g, 1, (c) => c.name === "holyLight");
    let fusionAsked = false;
    g.startTurn(0);
    attack(g, 0, card, 1, (r) => {
      if (r.type === "response") return { index: g.player(1).hand.indexOf(light) };
      if (r.skillId === "angerSuppression") return convert;
      if (r.skillId === "magicRuneFusion") { fusionAsked = true; return r.validSets.find((set) => set.length === 2); }
      return decide(r);
    });
    assert.equal(fusionAsked, !convert);
    assert.deepEqual([p.hero.state.battleRunes, p.hero.state.magicRunes], convert ? [1, 2] : [3, 0]);
    assert.equal(g.player(1).hand.length, convert ? 0 : 1);
    assert.equal(p.hand.length, convert ? 2 : 0);
    assert.equal(p.hero.state.battleRunes + p.hero.state.magicRunes, 3);
    g.assertCardLocations();
  }
});
