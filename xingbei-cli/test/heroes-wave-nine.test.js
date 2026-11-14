import test from "node:test";
import assert from "node:assert/strict";
import { Game, Timing } from "../src/engine.js";
import { ExclusiveCard } from "../src/card.js";
import { resolveSync } from "../src/resolution/decisions.js";
import { captureObservation } from "../src/ai/observation.js";
import { encodeEntities } from "../training/entity/observation.mjs";
import { decisionCandidates } from "../training/candidates.mjs";
const make = (id) =>
  new Game({
    seed: 37,
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
const take = (g, id, pred = () => true) => {
  const c = g.deck.find(pred);
  assert.ok(c);
  g.moveCard(c.id, { zone: "hand", playerId: id });
  return c;
};
const action = (g, id, skill) =>
  g.skillActionSteps(id, { skillId: skill, cardIds: [], targetIds: [] });

test("合成经过非伤害士气抵御；第五杯获胜后不再询问", () => {
  for (const heroId of ["cardinal", "lawgiver"]) for (const prevent of [false, true]) for (const fifthCup of [false, true]) {
    const g = make(heroId), p = g.player(0);
    p.hero.state.relics = 1;
    g.teams.red.morale = 1;
    g.teams.blue.cups = fifthCup ? 4 : 0;
    g.addStones("blue", "crystal", 3);
    let asked = 0;
    run(g.synthesizeSteps(1, 0), request => {
      if (["divineDeclaration", "sinAbsolution"].includes(request.skillId)) {
        asked++;
        assert.equal(request.context.cause.type, "synthesize");
        return prevent ? 1 : 0;
      }
      return base(request);
    });
    assert.equal(asked, fifthCup ? 0 : 1);
    assert.equal(g.teams.red.morale, fifthCup || prevent ? 1 : 0);
    assert.equal(p.hero.state.relics, !fifthCup && prevent ? 0 : 1);
    assert.equal(p.hero.state.silverBullets, !fifthCup && prevent ? 1 : 0);
    assert.equal(g.winner, fifthCup || !prevent ? "blue" : null);
    assert.equal(g.player(1).hand.length, 3);
    assert.equal(g.teams.blue.cups, fifthCup ? 5 : 1);
    g.assertCardLocations();
  }
});

test("铸律者：全场手限、治疗士气代价与换角色资源保留；非伤害抵御不作用于伤害", () => {
  const g = make("lawgiver"),
    p = g.player(0);
  assert.equal(g.player(1).handLimit, 5);
  p.hero.state.relics = 2;
  g.changeHealing(0, 1);
  run(g.flushRuleEvents(), (r) =>
    r.skillId === "sinAbsolution" ? 1 : base(r),
  );
  assert.equal(g.teams.red.morale, 15);
  assert.equal(p.hero.state.relics, 1);
  assert.equal(p.hero.state.silverBullets, 1);
  g.changeHealing(1, 2);
  run(g.flushRuleEvents());
  run(action(g, 0, "castling"), (r) =>
    r.skillId === "castlingHealing" ? 1 : base(r),
  );
  assert.equal(p.hero.id, "cardinal");
  assert.equal(p.hero.state.relics, 1);
  assert.equal(p.hero.state.silverBullets, 3);
  assert.equal(g.player(2).handLimit, 6);
  run(g.changeMoraleSteps("red", -2), (r) =>
    r.skillId === "divineDeclaration" ? 1 : base(r),
  );
  assert.equal(g.teams.red.morale, 14);
  assert.equal(p.hero.state.relics, 0);
  p.hero.state.relics = 3;
  p.handLimit = 1;
  take(g, 0);
  run(g.damageSteps(0, 2, { sourceId: 1, damageType: "spell" }));
  assert.equal(p.hero.state.relics, 3);
  g.assertCardLocations();
});
test("红衣主教：空手禁止驱魔，逆位保留资源，宝珠离场清理订阅", () => {
  for (const mode of ["attack", "spell", "holyFate"]) {
    const game = make("cardinal"), player = game.player(0);
    const usable = take(game, 0, card => mode === "holyFate"
      ? card.type === "attack" && card.fate === "S"
      : card.fate !== "S" && (mode === "attack" ? card.type === "attack" : card.name === "weakness"));
    const light = take(game, 0, card => card.name === "holyLight" && card.fate !== "S");
    if (mode === "holyFate") {
      const attacks = game.deck.filter(card => card.type === "attack").slice(0, 2);
      const drawnLight = game.deck.find(card => card.name === "holyLight");
      for (const card of [...attacks, drawnLight]) game.moveCard(card.id, { zone: "deck" });
    }
    player.hero.state.silverBullets = 2;
    player.healing = mode === "holyFate" ? 0 : 1;
    game.startTurn(0);
    let selected = false;
    run(game.activateSteps(0), request => {
      if (request.skillId === "exorcismRite") return true;
      if (request.skillId === "exorcismTarget") return 0;
      if (request.skillId === "exorcismCost") {
        selected = true;
        assert.equal(request.valid.includes(player.hand.indexOf(usable)), mode === "holyFate");
        return [player.hand.indexOf(mode === "holyFate" ? usable : light)];
      }
      return base(request);
    });
    assert.ok(selected);
    assert.ok(game.hasOrdinaryContinuation(0));
    assert.equal(game.winner, null);
    assert.equal(game.log.some(line => line.includes("无法行动，展示")), mode === "holyFate");
    game.assertCardLocations();
  }
  for (const handCount of [0, 1]) {
    const game = make("cardinal"), player = game.player(0);
    player.hero.state.silverBullets = 2;
    take(game, 3);
    if (handCount) take(game, 0);
    game.startTurn(0);
    if (!handCount) {
      assert.ok(game.canDrawSpecial(0));
      assert.ok(!game.activationSuppliers(0).some(skill => skill.id === "exorcismRite"));
    }
    let offered = false;
    run(game.trigger(Timing.ACTIVATION, { playerId: 0, usedSkills: {} }), request => {
      if (request.skillId === "exorcismRite") { offered = true; return false; }
      return base(request);
    });
    assert.equal(offered, handCount > 0);
    assert.equal(player.hero.state.silverBullets, 2);
    assert.equal(player.hand.length, handCount);
  }
  const g = make("cardinal"),
    p = g.player(0);
  p.hero.state.silverBullets = 2;
  const orb = p.hero.state.orbCardId;
  run(action(g, 0, "authorityReversal"));
  assert.equal(p.hero.id, "lawgiver");
  assert.equal(p.hero.state.orbCardId, orb);
  assert.equal(p.hero.state.relics, 2);
  const offering = take(g, 0);
  g.coverCards(0, [offering], "orbOffering", { reveal: true });
  for (const q of g.players) take(g, q.id, (c) => c.type === offering.type);
  let returnChoices = 0;
  const bulletsBeforeReturn = p.hero.state.silverBullets;
  run(p.hero.orbCircuit(g, p, offering, {}), (r) => {
    if (r.skillId === "royalPressure") return [r.valid[0]];
    if (r.skillId === "orbReturn") {
      returnChoices++;
      assert.equal(p.hero.state.silverBullets, bulletsBeforeReturn);
      assert.ok(r.choices.every(c => c.value === "cardinal" || c.value > 0));
      assert.equal(g.cards.get(orb).location.zone, "status");
    }
    return base(r);
  });
  assert.equal(returnChoices, 1);
  assert.equal(p.hero.id, "cardinal");
  assert.equal(g.cards.get(orb).location.zone, "outside");
  assert.equal(offering.location.zone, "discard");
  const before = p.hero.state.silverBullets;
  run(g.trigger(Timing.ATTACK_ACTION_END, { playerId: 0 }));
  assert.equal(p.hero.state.silverBullets, Math.min(3, before + 1));
  p.hero.state.silverGraceUsed = true;
  run(g.trigger(Timing.TURN_BEFORE, { playerId: 1 }));
  assert.equal(p.hero.state.silverGraceUsed, false);
  g.assertCardLocations();
});
test("记录者：公开遗迹、史书唯一实体使用即场外，知行合一不遗留临时行动", () => {
  const g = make("chronicler"),
    p = g.player(0);
  assert.equal(p.covered.length, 3);
  assert.equal(
    captureObservation(g, 1).cards.filter((c) => c.location.pile === "ruins")
      .length,
    3,
  );
  run(p.hero.gainArchives(g, p, 3, {}));
  const book = g.cards.get(p.hero.state.bookCardId);
  assert.equal(book.location.zone, "hand");
  run(g.actionSteps(0, p.hand.indexOf(book), 1));
  assert.equal(book.location.zone, "outside");
  assert.ok(g.player(1).hand.length > 0);
  g.startTurn(0);
  run(action(g, 0, "unityOfKnowledge"), (r) => {
    if (r.skillId === "studyCard") {
      assert.equal(p.covered.length, 3);
      assert.equal(g.field.length, 2);
      assert.ok(p.covered.every(card => card.coveredVisibility === "public"));
    }
    encodeEntities({
      game: g,
      playerId: r.playerId ?? r.target?.id ?? r.player?.id ?? 0,
      request: r,
      candidates: decisionCandidates(g, r),
    });
    return base(r);
  });
  assert.equal(p.covered.filter((c) => c.location.pile === "study").length, 0);
  assert.equal(p.hero.state.castingCardId, null);
  assert.equal(g.turn.state.completed, true);
  g.assertCardLocations();
});
test("传教士：首次放路标，跟随持有者回合，不改变实体座次；传递允许告解并可终止", () => {
  const g = make("missionary"),
    p = g.player(0);
  g.startTurn(0);
  assert.equal(p.hero.holder(g), 5);
  g.turn.state.skipped = true;
  g.endTurn();
  assert.equal(p.hero.holder(g), 4);
  assert.equal(g.current, 1);
  for (const id of [1, 2, 3, 4]) {
    g.startTurn(id);
    g.turn.state.skipped = true;
    g.endTurn();
  }
  assert.equal(g.current, 0);
  g.startTurn(0);
  g.turn.state.skipped = true;
  g.endTurn();
  assert.equal(g.current, 5);
  assert.deepEqual(
    g.players.map((p) => p.id),
    [0, 1, 2, 3, 4, 5],
  );
  run(p.hero.place(g, p, 1, true, {}), (r) =>
    r.skillId === "confession" ? r.playerId === 1 : base(r),
  );
  assert.ok(p.hero.state.confessedIds.includes(1));
  assert.notEqual(p.hero.holder(g), 1);
  assert.equal(g.stoneCounts("blue").crystal, 1);
  g.assertCardLocations();
});
test("异教徒：放逐只选6基础牌，摸牌限定6/7；预言洗混后对本人也隐藏，耗尽后才翻面", () => {
  const empty = make("heretic"), owner = empty.player(0);
  owner.energy = { gem: 0, crystal: 0 };
  owner.hero.state.prophecyFace = "thunderFire";
  empty.moveCard(owner.hero.state.prophecyCardId, { zone: "field" });
  owner.hero.addProphecies(empty, owner, [empty.deck[0], empty.deck[1]]);
  empty.addStones("red", "gem", 3);
  empty.startTurn(0);
  assert.ok(empty.activationChoices(0).find(skill => skill.id === "sacrifice").blockedReason);
  assert.equal(empty.canActivate(0), false);
  assert.ok(empty.canDrawSpecial(0));
  assert.ok(empty.canRefine(0));
  assert.throws(() => run(empty.activateSteps(0, { activationSkill: "sacrifice" })), /不能启动/);
  assert.equal(owner.covered.length, 2);
  take(empty, 0, card => card.name === "holyLight");
  assert.ok(empty.activationSuppliers(0).some(skill => skill.id === "sacrifice"));
  const g = make("heretic"),
    p = g.player(0);
  const exclusive = new ExclusiveCard({ id: "testBlade", name: "testBlade" });
  g.registerCard(exclusive, { zone: "hand", playerId: 0 });
  run(action(g, 0, "banishment"), (r) => {
    if (r.skillId === "banishmentDraw")
      assert.deepEqual(
        r.choices.map((c) => c.value),
        [6, 7],
      );
    if (r.skillId === "prophecyCards")
      assert.ok(!r.valid.includes(p.hand.indexOf(exclusive)));
    return base(r);
  });
  assert.equal(p.hand.includes(exclusive), true);
  assert.equal(p.hero.prophecies(p).length, 6);
  const obs = captureObservation(g, 0);
  assert.ok(p.covered.every((c) => !obs.cards.some((v) => v.id === c.id)));
  const encoded = encodeEntities({
    game: g,
    playerId: 0,
    request: { type: "action", playerId: 0 },
    candidates: [],
  });
  assert.ok(
    !encoded.entities.some(
      (e) => e.kind === "card" && e.categorical.zone === "covered",
    ),
  );
  for (let i = 0; i < 5; i++) g.discardCovered(0, p.hero.prophecies(p)[0]);
  const last = p.hero.prophecies(p)[0],
    deck = g.deck.length;
  run(g.damageSteps(1, 2, { sourceId: 2, damageType: "spell" }));
  assert.equal(last.location.zone, "hand");
  assert.equal(last.location.playerId, 1);
  assert.ok(g.deck.length <= deck - 1);
  assert.equal(p.hero.state.revealedFace, "thunderFire");
  assert.equal(
    g.cards.get(p.hero.state.prophecyCardId).name,
    "thunderCatastrophe",
  );
  g.assertCardLocations();
});
