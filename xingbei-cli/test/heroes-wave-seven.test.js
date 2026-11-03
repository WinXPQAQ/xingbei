import test from "node:test";
import assert from "node:assert/strict";
import { Game, Timing } from "../src/engine.js";
import { resolveSync } from "../src/resolution/decisions.js";
import { decisionCandidates } from "../training/candidates.mjs";
import { captureObservation } from "../src/ai/observation.js";
import { selectCovered } from "../src/heroes/shared/selection.js";
import { encodeEntities } from "../training/entity/observation.mjs";
const make = (id) =>
  new Game({
    seed: 91,
    shuffleDeck: false,
    heroIds: [id, "none", "none", "none", "none", "none"],
  });
const take = (g, id, fn) => {
  const c = g.deck.find(fn);
  assert.ok(c);
  g.moveCard(c.id, { zone: "hand", playerId: id });
  return c;
};
const base = (r) => (r.type === "response" ? null : r.defaultValue);
const run = (steps, choose = base) => resolveSync(steps, choose);
const cover = (g, id, pile, fn) => {
  const c = take(g, id, fn);
  g.coverCards(id, [c], pile);
  return c;
};
test("蝶舞：朝圣可减链接转入伤害；镜花分成两次法伤，凋零士气下限按期限结束", () => {
  const g = new Game({
      heroIds: [
        "soulWarlock",
        "none",
        "none",
        "butterflyDancer",
        "none",
        "none",
      ],
    }),
    p = g.player(0);
  p.hero.state.yellowSoul = 1;
  p.hero.state.blueSoul = 4;
  run(g.trigger(Timing.ACTIVATION, { playerId: 0 }), (r) =>
    r.skillId === "soulLink" ? (r.type === "playerChoice" ? 3 : true) : base(r),
  );
  const c = cover(g, 3, "cocoon", (c) => c.type === "attack");
  g.player(3).healing = 2;
  run(g.damageSteps(0, 3, { sourceId: 1, damageType: "attack" }), (r) =>
    r.skillId === "soulTransfer"
      ? 2
      : r.skillId === "pilgrimage"
        ? c.id
        : base(r),
  );
  assert.equal(g.player(3).hand.length, 1);
  assert.equal(g.player(3).healing, 2);
  assert.equal(c.location.zone, "discard");
  const h = make("butterflyDancer");
  const costs = [
    cover(h, 0, "cocoon", (c) => c.element === "fire"),
    cover(h, 0, "cocoon", (c) => c.element === "fire"),
  ];
  let pick = 0;
  const damage = [];
  h.player(0).hero.addSkills({
    id: "mirrorProbe",
    ...h.player(0).hero.bind("target", [Timing.DAMAGE_AFTER], "all", ["spell"]),
    resolve({ context }) {
      damage.push(context.actual);
    },
  });
  run(h.damageSteps(1, 2, { sourceId: 2, damageType: "spell" }), (r) =>
    r.skillId === "mirrorMoon" ? costs[pick++].id : base(r),
  );
  assert.deepEqual(damage, [1, 1, 0]);
  h.player(0).hero.state.witherProtection = true;
  h.changeMorale("blue", -20);
  assert.equal(h.teams.blue.morale, 1);
  assert.equal(h.winner, null);
  run(h.trigger(Timing.TURN_BEFORE, { playerId: 0 }));
  h.changeMorale("blue", -1);
  assert.equal(h.winner, "red");
  g.assertCardLocations();
  h.assertCardLocations();
});
test("战斗法师：置换和附魔均回合限定，第三行动熵变只执行一次", () => {
  const g = make("battleMage"),
    p = g.player(0);
  const a = take(g, 0, (c) => c.name === "fireStrike" && c.fate === "Y"),
    b = take(g, 0, (c) => c.name === "fireStrike");
  take(g, 0, (c) => c.name === "waterStrike");
  take(g, 0, (c) => c.name === "poison");
  g.startTurn(0);
  run(
    g.skillActionSteps(0, {
      skillId: "runeExchange",
      cardIds: [a.id, b.id],
      targetIds: [],
    }),
  );
  assert.equal(g.turn.nextAction().type, "attack");
  assert.equal(p.hero.state.runeExchangeUsed, true);
  run(
    g.actionSteps(
      0,
      p.hand.findIndex((c) => c.name === "waterStrike"),
      1,
    ),
    (r) => (r.skillId === "enchantedStrike" ? true : base(r)),
  );
  assert.equal(g.turn.nextAction().type, "spell");
  assert.equal(p.hero.state.enchantedStrikeUsed, true);
  let asks = 0;
  run(
    g.actionSteps(
      0,
      p.hand.findIndex((c) => c.name === "poison"),
      1,
    ),
    (r) => {
      if (r.skillId === "entropyShift") {
        asks++;
        return true;
      }
      return base(r);
    },
  );
  assert.equal(asks, 1);
  assert.equal(p.hero.state.actionCount, 3);
  assert.equal(g.player(2).hand.length, 1);
  g.assertCardLocations();
});
test("星坠：律法为专属实体，卢恩仅本人可见，繁星多目标结算后移除律法", () => {
  const g = make("starfallWitch"),
    p = g.player(0);
  assert.equal(p.statuses.length, 1);
  assert.equal(p.handLimit, 6);
  assert.equal(g.outside.length, 2);
  const cs = ["water", "fire", "wind", "thunder"].map((e) =>
    cover(g, 0, "rune", (c) => c.element === e),
  );
  let idx = 0;
  const enemy = captureObservation(g, 1);
  assert.ok(cs.every((c) => !enemy.cards.some((x) => x.id === c.id)));
  run(g.trigger(Timing.ACTIVATION, { playerId: 0 }), (r) =>
    r.skillId === "stellarRevelation"
      ? "invoke"
      : r.skillId === "revelationRunes"
        ? (cs[idx++]?.id ?? null)
        : r.skillId === "starlight"
          ? true
          : base(r),
  );
  assert.deepEqual(
    [1, 2, 5].map((id) => g.player(id).hand.length),
    [1, 1, 1],
  );
  assert.equal(p.statuses.length, 0);
  assert.equal(p.handLimit, 7);
  assert.equal(g.outside.length, 3);
  g.assertCardLocations();
});
test("圣庭：治疗溢出按事件入队、每回合一次，裁决所与普通治疗独立", () => {
  const g = new Game({
      heroIds: ["inquisitor", "none", "none", "priest", "none", "none"],
    }),
    p = g.player(0);
  assert.equal(g.getHealingLimit(0), 3);
  assert.equal(p.statuses[0].name, "inquisitionCourt");
  g.changeHealing(3, 7);
  run(g.flushRuleEvents(), (r) => (r.skillId === "verdict" ? true : base(r)));
  assert.equal(p.hero.state.courtHealing, 1);
  assert.equal(p.energy.crystal, 1);
  g.changeHealing(3, 1);
  run(g.flushRuleEvents(), (r) => (r.skillId === "verdict" ? true : base(r)));
  assert.equal(p.hero.state.courtHealing, 1);
  p.hero.state.courtHealing = 3;
  run(g.damageSteps(4, 2, { sourceId: 1, damageType: "spell" }), (r) =>
    r.skillId === "shelterDomain" ? true : base(r),
  );
  assert.equal(g.player(4).hand.length, 1);
  assert.equal(p.hero.state.rulings, 1);
  assert.equal(p.hero.state.courtHealing, 0);
  run(g.trigger(Timing.ACTIVATION, { playerId: 0 }), (r) =>
    r.skillId === "adjudicate" ? true : base(r),
  );
  assert.equal(p.hero.state.courtHealing, 2);
  assert.equal(p.hero.state.rulings, 2);
  assert.ok(!g.legalSkillActions(0).some((a) => a.skillId === "adjudicate"));
  g.assertCardLocations();
});
test("猎巫：法术转攻击用于同系应战，候选保留具体牌和目标；捕获盖牌不泄露", () => {
  const g = new Game({
      seed: 91,
      heroIds: [
        "witchHunter",
        "berserker",
        "berserker",
        "berserker",
        "berserker",
        "berserker",
      ],
    }),
    p = g.player(0);
  take(g, 1, (c) => c.name === "waterStrike");
  const c = take(
    g,
    0,
    (c) =>
      c.type === "spell" && c.element === "water" && c.name !== "holyLight",
  );
  run(g.actionSteps(1, 0, 0), (r) => {
    if (r.type === "response" && r.target.id === 0) {
      assert.equal(r.valid[0].asAttack, true);
      const candidates = decisionCandidates(g, r);
      assert.ok(candidates.some((x) => x?.index === 0 && x.targetId === 2));
      encodeEntities({ game: g, playerId: 0, request: r, candidates });
      return { index: 0, targetId: 2 };
    }
    return base(r);
  });
  assert.equal(g.player(2).hand.length, 2);
  assert.equal(c.location.zone, "discard");
  take(g, 0, (c) => c.name === "fireStrike");
  take(g, 1, (c) => c.type === "spell");
  run(g.actionSteps(0, 0, 1), (r) =>
    r.skillId === "witchSting" ? true : base(r),
  );
  assert.equal(p.covered.length, 1);
  assert.ok(
    !captureObservation(g, 1).cards.some((c) => c.id === p.covered[0].id),
  );
  g.assertCardLocations();
  const converted = take(g, 0, (c) => c.name === "holyShield");
  run(
    g.skillActionSteps(0, {
      skillId: "spellConversion",
      cardIds: [converted.id],
      targetIds: [5],
    }),
  );
  assert.equal(converted.type, "spell");
  assert.equal(converted.location.zone, "discard");
  assert.equal(g.player(5).hand.length, 2);
  assert.equal(g.player(5).statuses.length, 0);
  cover(g, 0, "manaBottle", (c) => c.type === "attack");
  let selected = 0;
  run(
    selectCovered(g, p, "manaBottle", {
      skillId: "ambushCost",
      min: 2,
      max: 2,
    }),
    (r) => {
      const values = decisionCandidates(g, r),
        o = encodeEntities({
          game: g,
          playerId: 0,
          request: r,
          candidates: values,
        });
      assert.equal(
        o.entities[o.question].refs.selectedCards.length,
        selected++,
      );
      assert.ok(o.candidates.every((c) => c.refs.cards.length === 1));
      return values[0];
    },
  );
  assert.equal(selected, 2);
});
test("圣殿：治疗溢出触发圣炎，伤害替换直接进入⑥，神威禁疗而非禁止使用治疗", () => {
  const g = make("templar"),
    p = g.player(0);
  assert.equal(g.getHealingLimit(0), 1);
  g.changeHealing(0, 2);
  run(g.flushRuleEvents());
  assert.equal(p.hero.state.holySeals, 1);
  assert.equal(p.hero.state.form, "holyFlame");
  assert.equal(p.healing, 0);
  let targetStages = 0;
  p.hero.addSkills({
    id: "replacementProbe",
    ...p.hero.onDamage([Timing.DAMAGE_BEFORE], "target"),
    priority: 100,
    resolve() {
      targetStages++;
    },
  });
  run(g.damageSteps(0, 3, { sourceId: 1, damageType: "spell" }));
  assert.equal(targetStages, 1);
  assert.equal(p.hand.length, 1);
  assert.equal(p.hero.state.form, null);
  p.hero.state.holySeals = 2;
  take(g, 0, (c) => c.name === "fireStrike");
  run(
    g.actionSteps(
      0,
      p.hand.findIndex((c) => c.name === "fireStrike"),
      1,
    ),
    (r) => (r.skillId === "divineMight" ? true : base(r)),
  );
  assert.equal(g.changeHealing(0, 1), 0);
  assert.equal(g.changeHealing(1, 1), 0);
  assert.equal(g.changeHealing(3, 1), 1);
  run(g.trigger(Timing.TURN_END, { playerId: 1 }));
  assert.equal(g.changeHealing(0, 1), 1);
  g.assertCardLocations();
});
