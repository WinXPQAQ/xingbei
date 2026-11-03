import test from "node:test";
import assert from "node:assert/strict";
import { Game, Timing } from "../src/engine.js";
import { resolveSync } from "../src/resolution/decisions.js";
import { sameElements, distinctElements, cardSets } from "../src/card-sets.js";
import { attackSteps } from "../src/resolution/attack.js";
import { captureObservation } from "../src/ai/observation.js";
import { encodeEntities } from "../training/entity/observation.mjs";
const make = (
  others = [
    "priest",
    "moonGoddess",
    "magicArcher",
    "swordEmperor",
    "witchHunter",
  ],
) => new Game({ seed: 83, heroIds: ["godEater", ...others] });
const base = (r) => (r.type === "response" ? null : r.defaultValue);
const run = (g, steps, choose = base) => resolveSync(steps, choose);
const take = (g, id, pred = () => true) => {
  const c = g.deck.find(pred);
  assert.ok(c);
  g.moveCard(c.id, { zone: "hand", playerId: id });
  return c;
};
const blade = (g, id, name = "demonBlade") => {
  const c = g.cards.get(g.player(0).hero.state[name + "Id"]);
  g.moveCard(c.id, { zone: "hand", playerId: id });
  return c;
};
const events = (g) => {
  const result = [];
  g.player(0).hero.addSkills({
    id: "auditDamage",
    ...g.player(0).hero.bind("target", [Timing.DAMAGE_BEFORE], "all"),
    priority: 1000,
    resolve: ({ context }) =>
      result.push({
        source: context.sourceId,
        target: context.targetId,
        amount: context.amount,
        skill: context.skillId,
      }),
  });
  return result;
};

test("刃实体唯一：交牌伤害归原持有者；直接盖牌1点、他人手牌转盖牌3+1，整组先移动", () => {
  const g = make(),
    log = events(g),
    c = blade(g, 1);
  g.giveCards(1, 3, [c]);
  run(g, g.flushRuleEvents());
  assert.deepEqual(
    log.map((e) => [e.source, e.target, e.amount]),
    [[0, 1, 3]],
  );
  assert.equal(c.location.playerId, 3);
  const ordinary = take(g, 3);
  const batch = [];
  g.player(0).hero.addSkills({
    id: "auditBatch",
    ...g.player(0).hero.onDamage([Timing.DAMAGE_BEFORE], "actor", ["spell"]),
    resolve: () => batch.push(ordinary.location.zone),
  });
  g.coverCards(3, [ordinary, c], "charge");
  run(g, g.flushRuleEvents());
  assert.equal(log.at(-1).amount, 1);
  assert.equal(log.at(-1).target, 3);
  assert.equal(batch[0], "covered");
  assert.equal(c.location.zone, "outside");
  assert.equal(ordinary.location.zone, "covered");
  blade(g, 1);
  run(g, g.player(5).hero.capture(g, g.player(5), 1, "witchSting", {}), (r) =>
    r.type === "cardChoice" ? [g.player(1).hand.indexOf(c)] : base(r),
  );
  assert.deepEqual(
    log.slice(-2).map((e) => [e.target, e.amount]),
    [
      [1, 3],
      [5, 1],
    ],
  );
  assert.equal(c.location.zone, "outside");
  blade(g, 5);
  run(g, g.player(5).hero.capture(g, g.player(5), 5, "spellStrip", {}), (r) =>
    r.type === "cardChoice" ? [g.player(5).hand.indexOf(c)] : base(r),
  );
  assert.deepEqual([log.at(-1).target, log.at(-1).amount], [5, 1]);
  g.assertCardLocations();
});

test("爆刃先插入3法伤再返回外层士气；月女两次分别响应，消失的暗月不能抵御外层士气", () => {
  const g = make(),
    log = events(g),
    p = g.player(1);
  p.handLimit = 1;
  const c = blade(g, 1);
  take(g, 1);
  const offers = [];
  run(
    g,
    g.overflowSteps(1, [0], {
      cause: { type: "damage", sourceId: 0, damageType: "attack" },
    }),
    (r) => {
      if (r.skillId === "newMoonShelter") {
        offers.push(r.context.discarded.length);
        return offers.length === 2;
      }
      return base(r);
    },
  );
  assert.deepEqual(offers, [3, 1]);
  assert.equal(g.teams.blue.morale, 11);
  assert.deepEqual(
    log.map((e) => [e.target, e.amount]),
    [
      [1, 3],
      [2, 1],
    ],
  );
  assert.equal(c.location.zone, "outside");
  assert.equal(g.player(2).covered.length, 0);
  assert.equal(g.player(2).hero.state.form, null);
  g.assertCardLocations();
});

test("双属性按费用／应战约束匹配：贤者不同系、冒险家同系；应战自动定系，主动攻击询问", () => {
  const g = make(),
    c = blade(g, 4),
    water = take(g, 4, (c) => c.element === "water"),
    fire = take(g, 4, (c) => c.element === "fire");
  assert.ok(sameElements(g, 4, [water, c]));
  assert.ok(distinctElements(g, 4, [water, c]));
  assert.ok(!distinctElements(g, 4, [water, fire, c]));
  assert.ok(
    !cardSets([water, fire, c], {
      cardCounts: [3],
      cardsFilter: (cs) => distinctElements(g, 4, cs),
    }).length,
  );
  const incoming = take(
    g,
    1,
    (c) => c.type === "attack" && c.element === "water",
  );
  const log = events(g);
  let asked = 0;
  run(g, attackSteps(g, 1, g.player(1).hand.indexOf(incoming), 4), (r) => {
    if (r.skillId === "bladeElement") {
      asked++;
      return "fire";
    }
    if (r.type === "response" && r.target.id === 4)
      return { index: g.player(4).hand.indexOf(c), targetId: 2 };
    return base(r);
  });
  assert.equal(asked, 0);
  assert.ok(
    g.publicHistory.actions.some(
      (e) =>
        e.type === "attack" &&
        e.actorId === 4 &&
        e.elements.length === 1 &&
        e.elements[0] === "water",
    ),
  );
  assert.equal(log[0].skill, "erosion");
  assert.equal(log[0].target, 4);
  const h = make();
  const b = blade(h, 1);
  let chosen = 0;
  run(h, attackSteps(h, 1, h.player(1).hand.indexOf(b), 0), (r) => {
    if (r.skillId === "bladeElement") {
      chosen++;
      return "water";
    }
    return base(r);
  });
  assert.equal(chosen, 1);
  assert.ok(
    h.publicHistory.actions.some(
      (e) => e.type === "attack" && e.elements[0] === "water",
    ),
  );
});

test("侵刻沿用场上原刃；剑帝／女仆长转盖牌额外1伤；王权宝珠要求专属而非攻击", () => {
  const g = make(),
    c = blade(g, 0);
  const log = events(g);
  run(g, attackSteps(g, 0, 0, 1), (r) =>
    r.skillId === "engraving" ? true : base(r),
  );
  assert.equal(c.location.zone, "hand");
  assert.equal(c.location.playerId, 1);
  assert.deepEqual([log[0].target, log[0].amount], [0, 1]);
  const h = make([
      "priest",
      "moonGoddess",
      "headMaid",
      "swordEmperor",
      "lawgiver",
    ]),
    b = blade(h, 4),
    light = take(h, 1, (c) => c.name === "holyLight");
  const hits = events(h);
  run(h, attackSteps(h, 4, h.player(4).hand.indexOf(b), 1), (r) =>
    r.type === "response" && r.target.id === 1
      ? { index: h.player(1).hand.indexOf(light) }
      : base(r),
  );
  assert.equal(b.location.zone, "outside");
  assert.deepEqual(
    hits.filter((e) => e.skill === "erosion").map((e) => e.amount),
    [3, 1],
  );
  blade(h, 3);
  run(h, h.player(3).hero.addShadows(h, h.player(3), [b], {}));
  assert.equal(b.location.zone, "outside");
  assert.equal(hits.at(-1).amount, 1);
  blade(h, 5);
  h.coverCards(5, [b], "orbOffering", { reveal: true });
  run(h, h.flushRuleEvents());
  assert.equal(b.location.zone, "covered");
  assert.equal(hits.at(-1).amount, 3);
  // Plain attacks cannot pay royal pressure for an exclusive offering.
  take(h, 5, (c) => c.type === "attack");
  let pressureAsked = false;
  run(h, h.player(5).hero.orbCircuit(h, h.player(5), b, {}), (r) => {
    if (r.skillId === "royalPressure") pressureAsked = true;
    return base(r);
  });
  assert.equal(pressureAsked, false);
  h.assertCardLocations();
});

test("诸神终焉同时直接移除刃，不渗蚀；两次3伤与额外2伤独立，胜利终止后续", () => {
  const g = make(),
    p = g.player(0);
  p.energy.gem = 1;
  blade(g, 1);
  blade(g, 2, "alienBlade");
  const log = events(g);
  run(
    g,
    g.skillActionSteps(0, { skillId: "ragnarok", cardIds: [], targetIds: [] }),
    (r) =>
      r.skillId === "bladeControl"
        ? null
        : r.skillId === "ragnarokTarget"
          ? 1
          : base(r),
  );
  assert.deepEqual(
    log.map((e) => [e.target, e.amount]),
    [
      [0, 2],
      [1, 3],
      [2, 3],
      [1, 2],
    ],
  );
  assert.ok(log.every((e) => e.skill === "ragnarok"));
  assert.ok(p.hero.blades(g).every((c) => c.location.zone === "outside"));
  for (let id = 0; id < 6; id++) {
    encodeEntities({
      game: g,
      playerId: id,
      request: { type: "action", playerId: id },
      candidates: [],
    });
    const obs = captureObservation(g, id);
    assert.ok(obs.cards.some((c) => c.id === p.hero.state.demonBladeId));
  }
  const h = make();
  h.player(0).energy.gem = 1;
  h.player(1).handLimit = 0;
  h.teams.blue.morale = 1;
  blade(h, 1);
  blade(h, 2, "alienBlade");
  const ended = events(h);
  run(
    h,
    h.skillActionSteps(0, { skillId: "ragnarok", cardIds: [], targetIds: [] }),
    (r) => (r.skillId === "bladeControl" ? null : base(r)),
  );
  assert.equal(h.winner, "red");
  assert.deepEqual(
    ended.map((e) => e.target),
    [0, 1],
  );
  g.assertCardLocations();
  h.assertCardLocations();
});

test("明弃双属性刃的封印：自由选择可避开封印，费用限定时自动定系；暗弃不触发", () => {
  const setup = () => {
    const g = make();
    const c = blade(g, 1);
    const seal = take(g, 0, (c) => c.element === "fire");
    g.attachCard(seal.id, 1, { effectId: "fireSeal", sourcePlayerId: 0 });
    return { g, c, seal };
  };
  const a = setup();
  let choices = 0;
  a.g.discardCards(1, [a.c]);
  run(a.g, a.g.flushRuleEvents(), (r) => {
    if (r.skillId === "bladeElement") {
      choices++;
      return "water";
    }
    return base(r);
  });
  assert.equal(choices, 1);
  assert.equal(a.seal.location.zone, "status");
  const b = setup();
  run(
    b.g,
    (function* () {
      const cs = yield* b.g.chooseHandCards(1, 1, (c) =>
        c.getTraits({ game: b.g, playerId: 1 }).elements.includes("fire"),
      );
      b.g.discardCards(1, cs);
      yield* b.g.flushRuleEvents();
    })(),
    (r) => {
      if (r.skillId === "bladeElement") throw Error("限定费用不得再问");
      return base(r);
    },
  );
  assert.equal(b.seal.location.zone, "discard");
  const c = setup();
  c.g.discardCards(1, [c.c], { visibility: "hidden" });
  run(c.g, c.g.flushRuleEvents(), (r) => {
    if (r.skillId === "bladeElement") throw Error("暗弃不询问公开系别");
    return base(r);
  });
  assert.equal(c.seal.location.zone, "status");
});

test("御刃及共振：从场外取回原实体、支付同系费用与水晶，受伤③插入1法伤后恢复原伤害", () => {
  const g = make(),
    p = g.player(0);
  let questions = 0;
  run(g, g.trigger(Timing.ACTIVATION, { playerId: 0 }), (r) => {
    if (r.skillId === "bladeControl") {
      questions++;
      return p.hero.state.demonBladeId;
    }
    return base(r);
  });
  assert.equal(questions, 1);
  assert.equal(g.cards.get(p.hero.state.demonBladeId).location.zone, "hand");
  g.moveCard(p.hero.state.demonBladeId, { zone: "outside" }, { removal: true });
  const fees = [
    take(g, 0, (c) => c.element === "water"),
    take(g, 0, (c) => c.element === "water"),
  ];
  p.energy.crystal = 1;
  const log = events(g);
  run(g, g.damageSteps(0, 2, { sourceId: 1, damageType: "spell" }), (r) =>
    r.skillId === "resonance"
      ? fees.map((c) => p.hand.indexOf(c))
      : r.skillId === "resonanceBlades"
        ? "both"
        : r.skillId === "resonanceTarget"
          ? 2
          : base(r),
  );
  assert.equal(p.energy.crystal, 0);
  assert.ok(fees.every((c) => c.location.zone === "discard"));
  assert.equal(
    p.hero.blades(g).filter((c) => c.location.zone === "hand").length,
    2,
  );
  assert.deepEqual(
    log.map((e) => [e.source, e.target, e.amount]),
    [
      [1, 0, 2],
      [0, 2, 1],
    ],
  );
  g.assertCardLocations();
});
