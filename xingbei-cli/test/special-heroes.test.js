import test from "node:test";
import assert from "node:assert/strict";
import { Game, Timing } from "../src/engine.js";
import { resolveSync } from "../src/resolution/decisions.js";
import { captureObservation } from "../src/ai/observation.js";
import { encodeEntities } from "../training/entity/observation.mjs";
const base = (r) => (r.type === "response" ? null : r.defaultValue);
const run = (g, decide = base) => resolveSync(g, decide);
const make = (
  id,
  others = ["berserker", "marksman", "priest", "guardianAngel", "sealer"],
) => new Game({ seed: 42, heroIds: [id, ...others] });
const take = (g, id, pred = () => true) => {
  const c = g.deck.find(pred);
  assert.ok(c);
  g.moveCard(c.id, { zone: "hand", playerId: id });
  return c;
};
const skill = (g, id, skillId, cards = [], targetIds = [], mode) =>
  g.skillActionSteps(
    id,
    {
      skillId,
      cardIds: cards.map((c) => c.id),
      targetIds,
      ...(mode ? { mode } : {}),
    },
    { overflow: "first" },
  );
const ask =
  (map = {}) =>
  (r) =>
    Object.hasOwn(map, r.skillId)
      ? typeof map[r.skillId] === "function"
        ? map[r.skillId](r)
        : map[r.skillId]
      : base(r);

test("特典继承差异：魔弓风而非雷禁应战，番长不等于必中；喧哗最多三张且血或法术可继续", () => {
  let g = make("magicArcherEX"),
    p = g.player(0);
  for (const element of ["wind", "thunder"]) {
    const context = {
      actorId: 0,
      targetId: 1,
      attackTraits: { elements: [element] },
      canCounter: true,
      card: take(g, 0, (c) => c.element === element && c.type === "attack"),
    };
    run(g.trigger(Timing.ATTACK_DECLARED, context));
    assert.equal(context.canCounter, element !== "wind");
  }
  g = make("delinquentGirl");
  p = g.player(0);
  const card = take(g, 0, (c) => c.hasUniqueSkill("bloodyRoar"));
  g.player(1).healing = 1;
  const context = {
    actorId: 0,
    targetId: 1,
    card,
    attackTraits: card.getTraits({ game: g, playerId: 0 }),
    isCounter: false,
    canCounter: true,
    canHolyLight: true,
    amount: 2,
  };
  run(
    g.trigger(Timing.ATTACK_DECLARED, context),
    ask({ delinquentRoar: true }),
  );
  assert.equal(context.forceHitRequested, undefined);
  assert.equal(context.canCounter, true);
  assert.equal(context.canDarkStrike, false);
  assert.equal(context.canHolyLight, false);
  const cards = [
    g.deck.find((c) => c.fate === "X" && c.type === "attack"),
    g.deck.find((c) => c.type === "spell" && c.fate !== "X"),
    g.deck.find((c) => c.type === "attack" && c.fate !== "X"),
  ];
  for (const c of cards.reverse()) {
    g.moveCard(c.id, { zone: "outside" }, { removal: true });
    g.moveCard(c.id, { zone: "deck" });
  }
  run(g.trigger(Timing.ATTACK_HIT, context));
  assert.equal(context.amount, 5);
  assert.ok(cards.every((c) => c.location.zone === "outside"));
  g.assertCardLocations();
});

test("提炼变体和六阶段转移：trick冒险家必须支付能量；暴食转移保留原伤害类别且不降士气", () => {
  const g = make("trickAdventurer", [
      "gluttonousGirl",
      "berserker",
      "priest",
      "guardianAngel",
      "sealer",
    ]),
    p = g.player(0);
  g.addStones("red", "gem", 2);
  g.addStones("red", "crystal", 2);
  assert.equal(g.skillActionSpec(0, { skillId: "adventurerParadise" }), null);
  p.energy.crystal = 1;
  run(
    skill(g, 0, "adventurerParadise", [], [], "2:0"),
    ask({
      trickParadiseCost: "0:1",
      trickParadiseTarget: (r) => r.choices[0].value,
    }),
  );
  assert.equal(p.energy.crystal, 0);
  assert.equal(g.stoneCounts("red").gem, 0);
  assert.equal(g.stoneCounts("red").crystal, 1);
  const q = g.player(1);
  q.handLimit = 1;
  take(g, 1, (c) => c.name === "magicBullet");
  take(g, 1);
  const before = g.teams.blue.morale;
  run(
    g.damageSteps(2, 3, {
      sourceId: 0,
      damageType: "attack",
      overflow: "first",
    }),
    ask({ appetiteBlackHole: (r) => [r.valid[0]] }),
  );
  assert.equal(g.player(2).hand.length, 0);
  assert.equal(g.teams.blue.morale, before);
  assert.equal(q.hand.length, 1);
  assert.ok(g.log.some((s) => s.includes("承受3点攻击伤害")));
  g.assertCardLocations();
});

test("基础效果生命周期：灵熙免疫、放置后法伤、实际触发后灵涌；未触发和专属效果不计", () => {
  const g = make("spiritTide");
  const shield = take(g, 0, (c) => c.name === "holyShield");
  assert.equal(g.canAttach(shield, 0, "holyShield"), false);
  g.attachCard(shield.id, 3, { effectId: "holyShield", sourcePlayerId: 0 });
  run(
    g.flushRuleEvents(),
    ask({ spiritExorcismOffer: true, spiritExorcism: 1 }),
  );
  assert.equal(g.player(1).hand.length, 1);
  run(
    g.trigger(Timing.ATTACK_HIT_CHECK, {
      actorId: 1,
      targetId: 3,
      hit: true,
      shieldable: false,
    }),
  );
  assert.equal(g.player(0).hero.state.surge, 0);
  run(
    g.trigger(Timing.ATTACK_HIT_CHECK, {
      actorId: 1,
      targetId: 3,
      hit: true,
      shieldable: true,
    }),
  );
  assert.equal(g.player(0).hero.state.surge, 1);
  const poison = take(g, 0, (c) => c.name === "poison");
  g.attachCard(poison.id, 2, { effectId: "poison", sourcePlayerId: 0 });
  run(g.turn.start(2, { overflow: "first" }));
  assert.equal(g.player(0).hero.state.surge, 2);
  g.assertCardLocations();
});

test("隐藏Tricky的规则和实体编码不含牌面；Surprise只接收基础牌，明牌音符保持顺序上限", () => {
  const g = make("mischiefGirl", [
    "godEater",
    "orchestraLeader",
    "priest",
    "guardianAngel",
    "sealer",
  ]);
  const card = g.deck[0];
  g.attachCard(card.id, 1, {
    effectId: "tricky",
    sourcePlayerId: 0,
    data: { hidden: true },
  });
  const capture = () => captureObservation(g, 2, { history: false });
  const request = { type: "action" };
  const encode = () =>
    encodeEntities({ game: g, playerId: 2, request, candidates: [] });
  const a = capture(),
    e = encode();
  const name = card.name;
  card.name = name === "fireStrike" ? "poison" : "fireStrike";
  assert.deepEqual(capture(), a);
  assert.deepEqual(encode(), e);
  card.name = name;
  assert.equal(a.cards.find((c) => c.id === card.id).name, "hiddenEffect");
  const blade = g.cards.get(g.player(1).hero.state.demonBladeId);
  g.moveCard(blade.id, { zone: "hand", playerId: 0 });
  const basic = take(g, 0, (c) => c.type === "spell");
  g.player(0).energy.crystal = 1;
  let checked = false;
  run(skill(g, 0, "surprise", [basic]), (r) => {
    if (r.skillId === "surpriseCard") {
      assert.ok(!r.valid.includes(g.player(0).hand.indexOf(blade)));
      checked = true;
      return null;
    }
    return base(r);
  });
  assert.ok(checked);
  const musician = g.player(2);
  for (let i = 0; i < 4; i++) run(musician.hero.addNote(g, musician, {}));
  assert.equal(musician.covered.length, 3);
  assert.ok(musician.covered.every((c) => c.coveredVisibility === "public"));
  g.assertCardLocations();
});

test("圣煌专属双面与天平实体：炮胜利立即停止；天罪允许一侧已满只放另一侧", () => {
  const g = make("primalArcher"),
    p = g.player(0);
  p.hero.state.form = "radiant";
  p.hero.state.faith = 10;
  g.teams.red.cups = 4;
  run(skill(g, 0, "radiantCannon"));
  assert.equal(g.winner, "red");
  assert.equal(p.hero.state.cannon, 2);
  assert.equal(p.healing, 0);
  assert.equal(g.cards.get(p.hero.state.cannonCardId).location.zone, "status");
  const h = make("holyAdjudicator"),
    q = h.player(0);
  for (let n = 0; n < 3; n++) {
    const c = take(h, 0, (c) => c.element === "water");
    h.coverCards(0, [c], "leftScale", { reveal: true });
  }
  q.hero.state.form = "heavenSin";
  take(h, 0, (c) => c.element === "fire");
  let count = 0;
  run(
    h.trigger(Timing.ATTACK_HIT, {
      actorId: 0,
      targetId: 1,
      isCounter: false,
      card: { type: "attack" },
    }),
    (r) => {
      if (r.skillId === "heavenSinCards") {
        count = r.count;
        return [r.valid[0]];
      }
      return base(r);
    },
  );
  assert.equal(count, 1);
  assert.equal(
    q.covered.filter((c) => c.location.pile === "rightScale").length,
    1,
  );
  h.assertCardLocations();
});

test("怠惰的双牌响应与剑之子变身：支付后才传递，誓言加伤只持续下一额外回合", () => {
  const g = make("slothGirl");
  take(g, 0, (c) => c.element === "water");
  take(g, 0, (c) => c.element === "water");
  assert.equal(g.canRefine(0), false);
  assert.equal(
    run(
      g
        .player(0)
        .hero.magicResponse(g, g.player(0), { targetId: 1, amount: 2 }, {}),
      ask({ slothMagicResponse: (r) => r.validSets[0], slothMagicTarget: 1 }),
    ),
    true,
  );
  assert.equal(g.player(0).hand.length, 0);
  const h = make("swordChild");
  const child = h.player(0);
  child.hero.state.oathHit = true;
  const spell = h.deck.find((c) => c.type === "spell");
  h.moveCard(spell.id, { zone: "outside" }, { removal: true });
  h.moveCard(spell.id, { zone: "deck" });
  run(h.trigger(Timing.TURN_END, { playerId: 1 }), ask({ swordOath: true }));
  assert.equal(child.hero.id, "windSwordmaster");
  assert.deepEqual(h.turn.extraTurns, [0]);
  assert.equal(child.hero.state.oathEmpowered, "waiting");
  run(h.trigger(Timing.TURN_START, { playerId: 0 }));
  let context = {
    actorId: 0,
    sourceId: 0,
    targetId: 1,
    amount: 2,
    damageType: "attack",
  };
  run(h.trigger(Timing.DAMAGE_BEFORE, context));
  assert.equal(context.amount, 3);
  run(h.trigger(Timing.TURN_END, { playerId: 0 }));
  assert.equal(child.hero.state.oathEmpowered, null);
  h.assertCardLocations();
  const turns = new Game({ heroRules: false });
  run(turns.turn.start(1));
  turns.turn.state.skipped = true;
  turns.turn.addExtraTurn(4);
  run(turns.turn.end());
  assert.equal(turns.current, 4);
  run(turns.turn.start(4));
  turns.turn.state.skipped = true;
  run(turns.turn.end());
  assert.equal(turns.current, 2);
});
