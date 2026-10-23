import test from "node:test";
import assert from "node:assert/strict";
import { Game } from "../src/engine.js";
import { captureObservation, observationView } from "../src/ai/observation.js";
import {
  valkyrieActionAdjustment,
  valkyrieRadiancePlan,
  valkyrieRuleDecision,
} from "../src/ai/hero-wave-two/valkyrie.js";
const game = () =>
  new Game({
    shuffleDeck: false,
    heroIds: ["valkyrie", "none", "none", "none", "none", "none"],
  });
const give = (g, id, predicate = () => true) => {
  const c = g.deck.find(predicate);
  assert.ok(c);
  g.moveCard(c.id, { zone: "hand", playerId: id });
  return c;
};
const view = (g) =>
  observationView(
    captureObservation(g, 0, { actions: true, activation: true }),
  );
const decide = (g, request) =>
  valkyrieRuleDecision({ playerId: 0, ...request }, view(g));

test("女武神：攻击先退出形态，命中有价值才计入重新召唤收益，圣盾不算命中", () => {
  const g = game();
  give(g, 0, (c) => c.name === "fireStrike");
  g.player(0).hero.state.form = "英灵";
  const action = { type: "play", index: 0, targetId: 1 };
  assert.ok(valkyrieActionAdjustment(view(g), 0, action) < 0);
  g.player(0).energy.crystal = 1;
  for (let i = 0; i < 6; i++) give(g, 1);
  assert.ok(valkyrieActionAdjustment(view(g), 0, action) > 0);
  const shield = g.deck.find((c) => c.name === "holyShield");
  g.attachCard(shield.id, 1, { effectId: "holyShield" });
  assert.ok(
    valkyrieActionAdjustment(view(g), 0, action) < 0,
    "圣盾阻止命中，不能把入形态当作已实现收益",
  );
});

test("女武神：英灵召唤比较士气/形态收益与能量，回合外不能借入形态获得奖励", () => {
  const g = game();
  g.player(0).energy.crystal = 1;
  for (let i = 0; i < 6; i++) give(g, 0);
  const request = {
    type: "skillChoice",
    skillId: "heroicSummon",
    context: { targetId: 1, amount: 2 },
  };
  assert.equal(
    decide(g, request),
    true,
    "己方满手无治疗，入形态有下回合治疗收益",
  );
  g.current = 1;
  assert.equal(decide(g, request), false, "回合外命中空手不耗能量");
  for (let i = 0; i < 6; i++) give(g, 1);
  assert.equal(decide(g, request), true, "回合外仍为实际额外士气损失开大");
});

test("女武神：英灵形态不阻止斩杀追击，已有额外攻击不重复支付治疗", () => {
  const g = game();
  g.player(0).hero.state.form = "英灵";
  g.player(0).healing = 1;
  give(g, 0, (c) => c.name === "darkStrike");
  for (let i = 0; i < 6; i++) give(g, 1);
  g.teams.blue.morale = 1;
  g.startTurn(0);
  g.player(0).hero.state.form = "英灵";
  g.player(0).healing = 1;
  const request = { type: "skillChoice", skillId: "divinePursuit" };
  assert.equal(decide(g, request), true);
  g.turn.addAttackAction({ sourceSkillId: "test" });
  assert.equal(decide(g, request), false);
  g.moveCard(g.player(0).hand[0].id, { zone: "discard" });
  assert.equal(decide(g, request), false);
});

test("女武神：军神威光允许单星石救满手队友，保留第五杯材料并避免溢出治疗", () => {
  const g = game();
  g.player(0).hero.state.form = "英灵";
  g.player(0).healing = 2;
  for (let i = 0; i < 6; i++) give(g, 3);
  g.addStones("red", "crystal");
  const plan = valkyrieRadiancePlan(view(g), 0);
  assert.equal(plan.mode, "stones");
  assert.equal(plan.payment, "0:1");
  assert.equal(plan.targetId, 3);
  g.addStones("red", "gem", 2);
  g.teams.red.cups = 4;
  assert.equal(valkyrieRadiancePlan(view(g), 0).mode, "reset");
  for (const p of g.players) p.healing = g.getHealingLimit(p.id);
  g.teams.red.cups = 0;
  assert.equal(valkyrieRadiancePlan(view(g), 0).mode, "reset");
});

test("女武神：英灵召唤追加弃牌保留第一张圣光，有效治疗才弃普通法术并选队友", () => {
  const g = game();
  give(g, 0, (c) => c.name === "holyLight");
  for (let i = 0; i < 6; i++) give(g, 3);
  const request = {
    type: "cardChoice",
    skillId: "heroicSummon",
    optional: true,
    count: 1,
    valid: [0],
  };
  assert.equal(decide(g, request), null);
  give(g, 0, (c) => c.name === "poison");
  assert.deepEqual(decide(g, { ...request, valid: [0, 1] }), [1]);
  const target = decide(g, {
    type: "playerChoice",
    skillId: "heroicSummon",
    choices: g.players.map((p) => ({ value: p.id })),
  });
  assert.equal(target, 3);
  for (const p of g.players) p.healing = g.getHealingLimit(p.id);
  assert.equal(decide(g, { ...request, valid: [0, 1] }), null);
});

test("女武神评分只依赖公开观测，对手换隐藏牌不改变形态与追击决策", () => {
  const g = game();
  give(g, 0, (c) => c.type === "attack");
  for (let i = 0; i < 6; i++) give(g, 1);
  g.player(0).energy.crystal = 1;
  const before = valkyrieActionAdjustment(view(g), 0, {
    type: "play",
    index: 0,
    targetId: 1,
  });
  for (const card of [...g.player(1).hand])
    g.moveCard(card.id, { zone: "discard", visibility: "hidden" });
  for (let i = 0; i < 6; i++) give(g, 1, (c) => c.type === "spell");
  assert.equal(
    valkyrieActionAdjustment(view(g), 0, {
      type: "play",
      index: 0,
      targetId: 1,
    }),
    before,
  );
});
