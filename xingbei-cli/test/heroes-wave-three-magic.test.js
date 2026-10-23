import test from "node:test";
import assert from "node:assert/strict";
import { Game, Timing } from "../src/engine.js";
import { resolveSync } from "../src/resolution/decisions.js";

const make = (hero, heroRules = true) => new Game({
  seed: 63, shuffleDeck: false, heroRules,
  heroIds: [hero, "none", "none", "none", "none", "none"],
});
const decide = (r) => r.type === "response" ? null : r.defaultValue;
function take(g, id, element) {
  const card = g.deck.find((c) => c.element === element);
  assert.ok(card);
  g.moveCard(card.id, { zone: "hand", playerId: id });
  return card;
}
function skill(g, skillId, cards = [], targetIds = [], mode, choose = decide) {
  return resolveSync(g.skillActionSteps(0, {
    type: "skill", skillId, cardIds: cards.map((c) => c.id), targetIds, mode,
  }, { overflow: "first", choose }), choose);
}
function repeat(g) { g.endTurn(0); g.turn.repeatLast(0); g.startTurn(0); }

test("仲裁者：初始能量、仪式形态、判决两模式与满审判的规则限制", () => {
  const g = make("adjudicator");
  assert.equal(g.player(0).energy.crystal, 2);
  assert.equal(make("adjudicator", false).player(0).energy.crystal, 0);
  g.player(0).energy.gem = 1;
  g.startTurn(0);
  skill(g, "judgmentBalance", [], [], "refill", (r) =>
    r.type === "skillChoice" && r.skillId === "judgmentRitual" ? true : decide(r));
  assert.equal(g.player(0).handLimit, 5);
  assert.equal(g.player(0).hand.length, 5);
  assert.equal(g.player(0).hero.state.judgment, 1);
  assert.equal(g.stoneCounts("red").gem, 1);
  repeat(g);
  assert.equal(g.player(0).hero.state.judgment, 2);
  g.damage(0, 1, { sourceId: 1, damageType: "spell", overflow: "first", useHealing: 0 });
  assert.equal(g.player(0).hero.state.judgment, 3);
  g.changeHealing(0, 1);
  g.damage(0, 1, { sourceId: 1, damageType: "spell", useHealing: 1 });
  assert.equal(g.player(0).hero.state.judgment, 3, "完全抵挡后不触发审判浪潮");
  const discarded = [...g.player(0).hand];
  skill(g, "judgmentBalance", [], [], "discard");
  assert.equal(g.player(0).hand.length, 0);
  assert.ok(discarded.every((c) => c.discardVisibility === "hidden"));
  repeat(g);
  assert.equal(g.player(0).hero.state.judgment, 4);
  assert.equal(g.player(0).hero.state.requiredJudgment, true);
  take(g, 0, "fire");
  g.addStones("red", "gem", 2);
  assert.deepEqual(g.legalCards(0), []);
  assert.equal(g.canDrawSpecial(0), false);
  assert.equal(g.canRefine(0), false);
  assert.deepEqual(g.legalSkillActions(0).map((s) => s.skillId), ["finalJudgment"]);
  assert.throws(() => skill(g, "judgmentBalance", [], [], "refill"));
  skill(g, "finalJudgment", [], [1]);
  assert.equal(g.player(1).hand.length, 4);
  assert.equal(g.player(0).hero.state.judgment, 0);
  assert.equal(g.player(0).hero.state.requiredJudgment, false);
  g.assertCardLocations();
});

test("仲裁者：强制审判仍经过启动，中断仪式后不能再次启动，胜利截断结算", () => {
  const g = make("adjudicator");
  g.player(0).hero.state.form = "审判";
  g.player(0).hero.state.judgment = 3;
  g.player(0).energy.gem = 1;
  for (let i = 0; i < 6; i++) take(g, 1, "fire");
  g.teams.blue.morale = 4;
  g.startTurn(0);
  skill(g, "finalJudgment", [], [1], undefined, (r) => {
    if (r.type === "skillChoice" && r.skillId === "ritualBreak") return true;
    assert.notEqual(r.skillId, "judgmentRitual", "一次启动不能中断后再入形态");
    return decide(r);
  });
  assert.equal(g.player(0).hero.state.form, null);
  assert.equal(g.player(0).handLimit, 6);
  assert.equal(g.player(0).energy.gem, 1);
  assert.equal(g.stoneCounts("red").gem, 1);
  assert.equal(g.winner, "red");
  assert.ok(!g.timeline.some((e) => e.timing === Timing.SPELL_ACTION_END));
  g.assertCardLocations();
});

test("贤者：四能量上限、异系法典费用与目标数、治疗后自伤及智慧法典", () => {
  const g = make("sage");
  assert.equal(g.getEnergyLimit(0), 4);
  assert.equal(g.gainEnergy(0, "gem", 5), 4);
  const cards = ["fire", "water", "wind", "earth"].map((e) => take(g, 0, e));
  assert.throws(() => skill(g, "holyCodex", cards.slice(0, 3), [0, 3]));
  assert.equal(g.player(0).energy.gem, 4, "非法目标数不支付费用");
  g.startTurn(0);
  skill(g, "holyCodex", cards, [0, 3], undefined, (r) => r.type === "healing" ? 2 : decide(r));
  assert.equal(g.player(3).healing, 2);
  assert.equal(g.player(0).healing, 0);
  assert.equal(g.player(0).hand.length, 1);
  assert.equal(g.player(0).energy.gem, 3);
  assert.ok(cards.every((c) => c.location.zone === "discard" && c.discardVisibility === "public"));
  g.damage(0, 4, { sourceId: 1, damageType: "spell", useHealing: 0, overflow: "first" });
  assert.equal(g.player(0).energy.gem, 4, "智慧法典增能受专属上限4约束");
  assert.equal(g.player(0).hand.length, 4, "摸4后暗弃1");
  assert.ok(g.discard.some((c) => c.discardVisibility === "hidden"));
  g.assertCardLocations();
});

test("贤者：异系费用拒绝同系、法术反弹可取消且目标胜利后不再自伤", () => {
  const invalid = make("sage");
  invalid.gainEnergy(0, "gem", 1);
  const same = [take(invalid, 0, "water"), take(invalid, 0, "water")];
  assert.throws(() => skill(invalid, "arcaneCodex", same, [1]));
  assert.equal(invalid.player(0).energy.gem, 1);
  const fire = take(invalid, 0, "fire");
  skill(invalid, "arcaneCodex", [same[0], fire], [1]);
  assert.equal(invalid.player(0).energy.gem, 0);
  assert.equal(invalid.player(1).hand.length, 1);
  assert.equal(invalid.player(0).hand.length, 2);
  invalid.assertCardLocations();
  const g = make("sage");
  const costs = [take(g, 0, "water"), take(g, 0, "water")];
  take(g, 1, "fire");
  g.player(1).handLimit = 1;
  g.teams.blue.morale = 1;
  let offered = 0;
  const choose = (r) => {
    if (r.type === "cardChoice" && r.skillId === "spellRebound") {
      offered++;
      return costs.map((c) => g.player(0).hand.indexOf(c));
    }
    if (r.type === "playerChoice" && r.skillId === "spellRebound") return 1;
    return decide(r);
  };
  resolveSync(g.damageSteps(0, 1, { sourceId: 1, damageType: "spell", useHealing: 0, overflow: "first", choose }), choose);
  assert.equal(offered, 1);
  assert.equal(g.winner, "red");
  assert.equal(g.player(0).hand.length, 1, "获胜后未执行反弹的2点自伤");
  assert.ok(costs.every((c) => c.discardVisibility === "public"));
  const declined = make("sage");
  take(declined, 0, "water"); take(declined, 0, "water");
  const decline = (r) => r.skillId === "spellRebound" ? null : decide(r);
  resolveSync(declined.damageSteps(0, 1, { sourceId: 1, damageType: "spell", useHealing: 0, choose: decline }), decline);
  assert.equal(declined.player(0).hand.length, 3);
  g.assertCardLocations(); declined.assertCardLocations();
});
