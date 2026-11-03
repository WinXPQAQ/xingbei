import test from "node:test";
import assert from "node:assert/strict";
import { Game, Timing } from "../src/engine.js";
import { resolveSync } from "../src/resolution/decisions.js";
import { captureObservation } from "../src/ai/observation.js";
import { encodeEntities } from "../training/entity/observation.mjs";
import { decisionCandidates } from "../training/candidates.mjs";
const make = (id) =>
  new Game({
    seed: 19,
    heroIds: [
      id,
      "berserker",
      "berserker",
      "berserker",
      "berserker",
      "berserker",
    ],
  });
const base = (r) => (r.type === "response" ? null : r.defaultValue);
const run = (s, decide = base) => resolveSync(s, decide);
const take = (g, id, fn) => {
  const c = g.deck.find(fn);
  assert.ok(c);
  g.moveCard(c.id, { zone: "hand", playerId: id });
  return c;
};
test("矜贵之女：提炼宝石奖励水晶，第三次魔法入门由Magic结算，公开摸牌带真实牌面", () => {
  const g = make("nobleLady"),
    p = g.player(0);
  g.addStones("red", "gem", 2);
  g.startTurn(0);
  g.refine(0, { gem: 2, crystal: 0 });
  assert.deepEqual(p.energy, { gem: 2, crystal: 1 });
  g.endTurn();
  g.startTurn(0);
  p.hero.state.lessons = 2;
  const c = g.deck.find((c) => c.type === "spell" && c.element === "water");
  g.moveCard(c.id, { zone: "deck" });
  run(
    g.skillActionSteps(0, {
      skillId: "magicLesson",
      cardIds: [],
      targetIds: [],
    }),
    (r) =>
      r.skillId === "magicSpark"
        ? true
        : r.skillId === "lessonSpellTargets"
          ? r.choices[0].value
          : r.skillId === "lessonHealing"
            ? 0
            : base(r),
  );
  assert.equal(p.hero.state.lessons, 3);
  assert.equal(g.stoneCounts("red").gem, 2);
  assert.equal(p.healing, 1);
  assert.equal(g.player(1).hand.length, 1);
  assert.ok(g.log.some((s) => s.includes("展示") && s.includes("矜贵之女")));
  g.assertCardLocations();
});
test("女仆长：摹影保存命中牌，风穴收弃牌；影缝弃牌不足扣士气且观看只给本人", () => {
  const g = make("headMaid"),
    p = g.player(0);
  const c = take(g, 0, (c) => c.type === "attack");
  run(g.actionSteps(0, 0, 1), (r) =>
    r.skillId === "shadowCopy" ? true : base(r),
  );
  assert.equal(c.location.pile, "shadow");
  g.attachCard(p.hero.state.tunnelCardId, 2, {
    effectId: "windTunnel",
    sourcePlayerId: 0,
  });
  const attack = take(g, 2, (c) => c.type === "attack");
  run(g.actionSteps(2, 0, 3));
  assert.equal(attack.location.pile, "shadow");
  assert.equal(attack.location.playerId, 0);
  p.hero.state.threads = 2;
  const peek = take(g, 2, (c) => c.type === "spell");
  const morale = g.teams.blue.morale;
  let viewed = false;
  run(g.trigger(Timing.TURN_START, { playerId: 2 }), (r) => {
    if (r.skillId === "shadowStitch") return 2;
    if (r.skillId === "shadowStitchCard") {
      viewed = true;
      assert.deepEqual(
        r.revealedCards.map((c) => c.id),
        [peek.id],
      );
      assert.ok(
        captureObservation(g, 0, { revealedCards: r.revealedCards }).cards.some(
          (c) => c.id === peek.id,
        ),
      );
      assert.ok(!captureObservation(g, 1).cards.some((c) => c.id === peek.id));
      encodeEntities({
        game: g,
        playerId: 0,
        request: r,
        candidates: decisionCandidates(g, r),
      });
    }
    return base(r);
  });
  assert.equal(viewed, true);
  assert.equal(g.teams.blue.morale, morale - 1);
  const enemy = captureObservation(g, 1);
  assert.ok(p.covered.every((c) => !enemy.cards.some((x) => x.id === c.id)));
  g.assertCardLocations();
});
test("结界师：公开结界进入全部观测；绝界禁止基础效果但不移除，最后结界离场后解除", () => {
  const g = make("barrierMaster"),
    p = g.player(0);
  const cs = [
    take(g, 0, (c) => c.element === "water"),
    take(g, 0, (c) => c.element === "fire"),
  ];
  run(
    g.skillActionSteps(0, {
      skillId: "barrierRitual",
      cardIds: cs.map((c) => c.id),
      targetIds: [],
    }),
  );
  assert.equal(p.hero.state.ritual, 1);
  assert.ok(captureObservation(g, 1).cards.some((c) => c.id === cs[0].id));
  const snapshot = encodeEntities({
    game: g,
    playerId: 1,
    request: { type: "action", playerId: 1 },
    candidates: [],
  });
  assert.ok(
    snapshot.entities.some(
      (e) => e.kind === "card" && e.categorical.zone === "covered",
    ),
  );
  run(
    g.skillActionSteps(0, {
      skillId: "forbiddenRealm",
      cardIds: [],
      targetIds: [3],
    }),
  );
  const poison = take(g, 1, (c) => c.name === "poison");
  g.attachCard(poison.id, 3, { effectId: "poison", sourcePlayerId: 1 });
  run(g.trigger(Timing.ACTION_PHASE_BEFORE, { playerId: 3 }));
  assert.equal(g.player(3).hand.length, 0);
  assert.equal(poison.location.zone, "status");
  run(p.hero.removeBarrier(g, p));
  run(p.hero.removeBarrier(g, p));
  assert.equal(g.cards.get(p.hero.state.realmCardId).location.zone, "outside");
  run(g.trigger(Timing.ACTION_PHASE_BEFORE, { playerId: 3 }));
  assert.equal(g.player(3).hand.length, 1);
  assert.equal(poison.location.zone, "discard");
  g.assertCardLocations();
});
test("神秘学者：真言压制立即续接，妖精秘术收尾，技能行动不能留在额外队列", () => {
  const g = make("mystic"),
    p = g.player(0);
  p.energy.crystal = 2;
  const attack = take(g, 0, (c) => c.name === "waterStrike" && c.fate === "Y"),
    spell = take(g, 0, (c) => c.name === "poison");
  g.coverCards(0, [attack, spell], "word", { reveal: true });
  take(g, 0, (c) => c.name === "fireStrike");
  g.startTurn(0);
  const order = ["suppress", "word", "fairy"];
  let cast = 0;
  let continuation = 0;
  run(
    g.skillActionSteps(0, { skillId: "trueWord", cardIds: [], targetIds: [] }),
    (r) => {
      encodeEntities({
        game: g,
        playerId: r.playerId ?? r.target?.id ?? r.player?.id ?? 0,
        request: r,
        candidates: decisionCandidates(g, r),
      });
      if (r.skillId === "trueWordCard") return [attack, spell][cast++].id;
      if (
        [
          "trueWordTarget",
          "wordDamageTarget",
          "suppressionTarget",
          "fairyAttackTarget",
        ].includes(r.skillId)
      )
        return 1;
      if (r.skillId === "mysticContinuation") return order[continuation++];
      return base(r);
    },
  );
  assert.equal(cast, 2);
  assert.equal(continuation, 3);
  assert.equal(p.energy.crystal, 1);
  assert.equal(p.hero.state.sorcery, 2);
  assert.equal(p.hero.state.fairyUsed, true);
  assert.deepEqual(g.turn.state.pendingActions, []);
  assert.equal(g.turn.state.actionType, "spell");
  assert.equal(g.turn.state.completed, true);
  assert.equal(p.hero.state.castingWordId, null);
  g.assertCardLocations();
});
test("染污者：禁止获疗、狂戾转形、伤害加成与四点上限，零戾气重置转换水晶", () => {
  const g = make("defiler"),
    p = g.player(0);
  assert.equal(p.energy.crystal, 1);
  assert.equal(g.changeHealing(0, 2, { limit: 6 }), 0);
  p.hero.state.malice = 2;
  g.player(1).healing = 2;
  run(g.trigger(Timing.TURN_START, { playerId: 0 }), (r) =>
    r.skillId === "ragingHeartTarget" ? 1 : base(r),
  );
  assert.equal(p.hero.state.form, "raging");
  assert.equal(g.player(1).healing, 0);
  const light = take(g, 0, (c) => c.name === "holyLight");
  assert.equal(g.allowsCard(0, light, "response"), false);
  run(g.damageSteps(0, 6, { sourceId: 1, damageType: "spell" }));
  assert.equal(p.hand.length, 5);
  assert.equal(p.hero.state.malice, 1);
  run(g.damageSteps(1, 1, { sourceId: 0, damageType: "spell" }), (r) =>
    r.skillId === "mindPollution" ? true : base(r),
  );
  assert.equal(g.player(1).hand.length, 3);
  assert.equal(p.hero.state.malice, 0);
  run(g.trigger(Timing.TURN_END, { playerId: 0 }));
  assert.equal(p.hero.state.form, null);
  assert.deepEqual(p.energy, { gem: 1, crystal: 0 });
  g.assertCardLocations();
});
test("剑之魔女：限定技命格行动可放弃，后续攻击属性在①设置且仍经过②", () => {
  const g = make("swordWitch"),
    p = g.player(0);
  take(g, 0, (c) => c.name === "fireStrike" && c.fate !== "J");
  const normal = take(g, 0, (c) => c.type === "attack" && c.fate !== "J");
  const technique = take(g, 0, (c) => c.type === "attack" && c.fate === "J");
  g.startTurn(0);
  run(g.actionSteps(0, 0, 1), (r) =>
    r.skillId === "techniqueIntent" ? true : base(r),
  );
  assert.equal(g.turn.nextAction().fate, "J");
  assert.equal(g.legalTargets(0, normal).length, 0);
  assert.ok(g.legalTargets(0, technique).length);
  g.skipExtraActions(0);
  assert.equal(g.turn.hasExtraActions(), false);
  g.endTurn();
  p.hero.state.attacksCompleted = 4;
  const before = g.timeline.length;
  run(g.actionSteps(0, p.hand.indexOf(normal), 2));
  assert.ok(
    g.timeline
      .slice(before)
      .some((e) => e.timing === "attackDecision" && e.point === 2),
  );
  assert.ok(g.player(2).hand.length > 0);
  g.assertCardLocations();
});
