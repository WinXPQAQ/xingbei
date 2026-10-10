import test from "node:test";
import assert from "node:assert/strict";
import { Game, RuleError, Timing } from "../src/engine.js";
import { Card, BasicCard, AttackCard, SpellCard, ExclusiveCard, createBasicCard } from "../src/card.js";

const take = (game, name) => game.deck.find(card => card.name === name);
const hand = (game, playerId, name) => game.moveCard(take(game, name).id, { zone: "hand", playerId });

test("牌继承、唯一登记、六区域移动与专属牌授予技能遵循实体生命周期", () => {
  const game = new Game({ shuffleDeck: false });
  const attack = take(game, "waterStrike"), spell = take(game, "poison");
  assert.ok(attack instanceof Card && attack instanceof BasicCard && attack instanceof AttackCard);
  assert.ok(spell instanceof SpellCard);
  assert.throws(() => { attack.id = "changed"; }, TypeError);
  assert.throws(() => game.registerCard(attack, { zone: "deck" }), RuleError);
  assert.throws(() => game.registerCard(createBasicCard({ id: "new-basic", name: "poison", element: "water", fate: "H" }), { zone: "hand", playerId: 0 }), RuleError);
  const outside = new ExclusiveCard({ id: "hero-seal", name: "heroSeal", heroId: "berserker", skills: ["extraAbility"] });
  game.registerCard(outside, { zone: "outside" });
  assert.deepEqual(outside.getTraits(), { elements: [], fates: [] });
  for (const location of [{ zone: "deck" }, { zone: "hand", playerId: 0 }, { zone: "field" }, { zone: "discard" }]) {
    game.moveCard(outside.id, location); assert.equal(game.assertCardLocations(), true);
  }
  game.attachCard(outside.id, 0, { effectId: "heroSeal", sourcePlayerId: 0 });
  assert.ok(game.player(0).getSkills().some(source => source.skill === "extraAbility" && source.sourceCard === outside));
  assert.equal(game.player(0).getBasicEffects().length, 0);
  game.removeEffect(outside.id, { zone: "outside" });
  assert.equal(game.player(0).getSkills().length, 0);
  const attached = new ExclusiveCard({ id: "starting-seal", name: "heroSeal" });
  game.registerCard(attached, { zone: "status", playerId: 3 });
  assert.equal(attached.location.playerId, 3);
  assert.throws(() => game.moveCard(outside.id, { zone: "hand", playerId: 99 }), RuleError);
  assert.equal(outside.location.zone, "outside");
  assert.equal(game.assertCardLocations(), true);
});

test("有效属性查询支持双属性、空命格和英雄覆盖，原属性及其他用途保持独立", async () => {
  const game = new Game({ shuffleDeck: false });
  const attack = take(game, "waterStrike"), response = take(game, "fireStrike");
  const dual = new ExclusiveCard({ id: "dual", name: "dualElement", elements: ["water", "fire"] });
  game.registerCard(dual, { zone: "outside" });
  assert.deepEqual(dual.getTraits(), { elements: ["water", "fire"], fates: [] });
  game.registerSkill("fireResponse", {
    filter: context => context.playerId === 1 && context.purpose === "response",
    modifyTraits: (_context, traits) => ({ ...traits, elements: ["water"], fates: ["S"] }),
  });
  game.registerSkill("lowerPriority", {
    priority: -10, filter: context => context.playerId === 1 && context.purpose === "response",
    modifyTraits: (_context, traits) => ({ ...traits, elements: ["earth"] }),
  });
  game.player(1).hero.skills.push("fireResponse", "lowerPriority");
  const printed = response.getPrintedTraits();
  assert.equal(game.canRespond(attack, response, { actorId: 0, targetId: 1 }), true);
  assert.equal(game.canRespond(attack, response, { actorId: 0, targetId: 2 }), false);
  assert.deepEqual(response.getPrintedTraits(), printed);
  assert.deepEqual(response.getTraits({ game, playerId: 1, purpose: "cost" }), printed);
  assert.deepEqual(response.getTraits({ game, playerId: 1, purpose: "response" }), { elements: ["water"], fates: ["S"] });
  const chain = new Game({ shuffleDeck: false });
  chain.registerSkill("heldFire", {
    filter: context => context.playerId === 0 && context.card.location.zone === "hand",
    modifyTraits: (_context, traits) => ({ ...traits, elements: ["fire"] }),
  });
  chain.player(0).hero.skills.push("heldFire");
  const used = hand(chain, 0, "waterStrike");
  hand(chain, 1, "fireStrike");
  await chain.attackWithDecisions(0, 0, 1, { chooseResponse: context => {
    assert.equal(used.location.zone, "discard");
    assert.deepEqual(context.attackTraits.elements, ["fire"]);
    assert.equal(context.valid[0].card.name, "fireStrike");
    return null;
  } });

});

test("多个中毒是独立基础效果，先于虚弱逐牌处理；其他基础效果默认不叠加", async () => {
  const game = new Game({ shuffleDeck: false });
  const poisons = game.deck.filter(card => card.name === "poison").slice(0, 2);
  for (const card of poisons) game.attachCard(card.id, 0, { effectId: "poison", sourcePlayerId: 1 });
  const weakness = take(game, "weakness");
  game.attachCard(weakness.id, 0, { effectId: "weakness", sourcePlayerId: 2 });
  assert.equal(game.player(0).getBasicEffects().length, 3);
  assert.throws(() => game.attachCard(take(game, "weakness").id, 0, { effectId: "weakness" }), RuleError);
  game.registerEffect("heroMark", { timings: [] });
  game.attachCard(take(game, "waterStrike").id, 3, { effectId: "heroMark", sourceSkillId: "testMark" });
  assert.throws(() => game.attachCard(take(game, "fireStrike").id, 3, { effectId: "heroMark" }), RuleError);
  await game.beginTurn(0, { chooseWeakness: () => {
    assert.equal(game.player(0).hand.length, 2);
    assert.equal(game.player(0).poisons.length, 0);
    assert.ok(poisons.every(card => card.location.zone === "discard"));
    return "skip";
  } });
  game.endTurn();
  assert.deepEqual(game.timeline.filter(event => ![Timing.DAMAGE_BEFORE, Timing.DAMAGE_AFTER].includes(event.timing)).map(event => event.timing),
    [Timing.TURN_START, Timing.ACTION_PHASE_BEFORE, Timing.ACTION_PHASE_SKIPPED, Timing.TURN_END]);
  assert.equal(game.assertCardLocations(), true);
});

test("回合明确区分普通和特殊路线，攻击/法术行动结束与回合结束各自触发", async () => {
  for (const route of ["attack", "spell", "special"]) {
    const game = new Game({ shuffleDeck: false });
    game.registerSkill("startHook", { timings: [Timing.TURN_START], async resolve({ player }) { await Promise.resolve(); player.hero.state.started = true; } });
    game.player(0).hero.skills.push("startHook");
    await game.beginTurn(0);
    assert.equal(game.player(0).hero.state.started, true);
    if (route === "attack") {
      const attack = hand(game, 0, "waterStrike");
      game.attachCard(take(game, "holyShield").id, 1, { effectId: "holyShield" });
      await game.attackWithDecisions(0, game.player(0).hand.indexOf(attack), 1);
      assert.equal(game.player(1).hand.length, 0);
      assert.equal(game.teams.red.achievements.length, 0);
      assert.ok(game.timeline.some(event => event.timing === Timing.ATTACK_MISS));
      assert.ok(!game.timeline.some(event => event.timing === Timing.ATTACK_HIT));
    } else if (route === "spell") {
      const spell = hand(game, 0, "poison");
      await game.playWithDecisions(0, game.player(0).hand.indexOf(spell), 1);
    } else game.purchase(0);
    const timings = game.timeline.map(event => event.timing);
    assert.equal(timings.includes(Timing.ACTIVATION), route !== "special");
    const prefix = { attack: "attackAction", spell: "spellAction", special: "specialAction" }[route];
    assert.ok(timings.indexOf(prefix + "Start") < timings.indexOf(prefix + "End"));
    await game.endTurnWithDecisions();
    assert.deepEqual(game.timeline.slice(-2).map(event => event.timing), [Timing.ACTION_PHASE_END, Timing.TURN_END]);
    assert.equal(game.current, 1);
    assert.equal(game.assertCardLocations(), true);
  }
});
