import test from "node:test";
import assert from "node:assert/strict";
import { Game, RuleError, Timing } from "../src/engine.js";
import { Card, BasicCard, AttackCard, SpellCard, ExclusiveCard, createBasicCard } from "../src/card.js";
import { BASIC_EFFECTS } from "../src/effects.js";

const take = (game, name) => game.deck.find(card => card.name === name);
const hand = (game, playerId, name) => game.moveCard(take(game, name).id, { zone: "hand", playerId });

test("牌继承、唯一登记、六区域移动与专属牌授予技能遵循实体生命周期", () => {
  const game = new Game({ heroRules: false, shuffleDeck: false });
  const attack = take(game, "waterStrike"), spell = take(game, "poison");
  assert.ok(attack instanceof Card && attack instanceof BasicCard && attack instanceof AttackCard);
  assert.ok(spell instanceof SpellCard);
  for (const name of ["poison", "holyShield", "weakness"]) {
    const card = take(game, name);
    assert.equal(card.effectDefinition, BASIC_EFFECTS[name]);
    hand(game, 0, name);
    game.play(0, game.player(0).hand.indexOf(card), 1);
    assert.deepEqual(game.player(1).getStatus(name), [card]);
    assert.equal(card.attachment.effectId, card.effectDefinition.id);
    game.removeEffect(card.id);
    assert.deepEqual(game.player(1).getStatus(name), []);
  }
  assert.deepEqual(game.player(1).getStatus("unknown"), []);
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
  const game = new Game({ heroRules: false, shuffleDeck: false });
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
  game.player(1).hero.addSkills("fireResponse", "lowerPriority");
  const printed = response.getPrintedTraits();
  assert.equal(game.canRespond(attack, response, { actorId: 0, targetId: 1 }), true);
  assert.equal(game.canRespond(attack, response, { actorId: 0, targetId: 2 }), false);
  assert.deepEqual(response.getPrintedTraits(), printed);
  assert.deepEqual(response.getTraits({ game, playerId: 1, purpose: "cost" }), printed);
  assert.deepEqual(response.getTraits({ game, playerId: 1, purpose: "response" }), { elements: ["water"], fates: ["S"] });
  const chain = new Game({ heroRules: false, shuffleDeck: false });
  chain.registerSkill("heldFire", {
    filter: context => context.playerId === 0 && context.card.location.zone === "hand",
    modifyTraits: (_context, traits) => ({ ...traits, elements: ["fire"] }),
  });
  chain.player(0).hero.addSkills("heldFire");
  const used = hand(chain, 0, "waterStrike");
  hand(chain, 1, "fireStrike");
  await chain.attackWithDecisions(0, 0, 1, { chooseResponse: context => {
    assert.equal(used.location.zone, "field");
    assert.deepEqual(context.attackTraits.elements, ["fire"]);
    assert.equal(context.valid[0].card.name, "fireStrike");
    return null;
  } });

});

test("多个中毒是独立基础效果，先于虚弱逐牌处理；其他基础效果默认不叠加", async () => {
  const game = new Game({ heroRules: false, shuffleDeck: false });
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
    assert.equal(game.player(0).getStatus("poison").length, 0);
    assert.ok(poisons.every(card => card.location.zone === "discard"));
    return "skip";
  } });
  game.endTurn();
  assert.deepEqual(game.timeline.filter(event => ![Timing.DAMAGE_BEFORE, Timing.HEALING_BEFORE, Timing.DAMAGE_ACTUAL_BEFORE, Timing.DAMAGE_ACTUAL, Timing.DAMAGE_AFTER].includes(event.timing)).map(event => event.timing),
    [Timing.TURN_BEFORE, Timing.TURN_START, Timing.ACTION_PHASE_BEFORE, Timing.DRAW_BEFORE, Timing.DRAW_BEFORE, Timing.ACTION_PHASE_SKIPPED, Timing.TURN_END]);
  assert.equal(game.assertCardLocations(), true);
});

test("回合明确区分普通和特殊路线，攻击/法术行动结束与回合结束各自触发", async () => {
  for (const route of ["attack", "spell", "special"]) {
    const game = new Game({ heroRules: false, shuffleDeck: false });
    game.registerSkill("startHook", { timings: [Timing.TURN_START], async resolve({ player }) { await Promise.resolve(); player.hero.state.started = true; } });
    game.player(0).hero.addSkills("startHook");
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

test("呈现检查点不改变同步/异步结算，快照隔离后续牌移动并先播放再询问响应", async () => {
  const prepare = () => {
    const game = new Game({ heroRules: false, shuffleDeck: false, seed: 23 });
    hand(game, 0, "waterStrike"); hand(game, 1, "waterStrike"); hand(game, 3, "holyLight");
    return game;
  };
  const sync = prepare(), asyncGame = prepare(), batches = [];
  sync.enablePresentation();
  const responses = { 1: { index: 0, targetId: 3 }, 3: { index: 0 } };
  sync.startTurn(0); sync.attack(0, 0, 1, { responses }); sync.endTurn();
  asyncGame.enablePresentation(async events => { await Promise.resolve(); batches.push(...events); });
  await asyncGame.beginTurn(0);
  await asyncGame.attackWithDecisions(0, 0, 1, { chooseResponse: context => {
    const lastMove = batches.filter(event => event.type === "move").at(-1);
    assert.equal(lastMove.from.playerId, context.actor.id);
    assert.equal(lastMove.reason, "play");
    assert.equal(asyncGame.field.length, context.target.id === 1 ? 1 : 2);
    assert.equal(asyncGame.discard.length, 0);
    return responses[context.target.id];
  } });
  await asyncGame.endTurnWithDecisions();
  assert.deepEqual(JSON.parse(JSON.stringify(asyncGame)), JSON.parse(JSON.stringify(sync)));
  assert.deepEqual(batches.filter(event => event.type === "move").map(event => event.from.playerId), [0, 1, 3]);
  const first = batches.find(event => event.type === "move");
  assert.equal(first.view.players[1].hand.length, 1);
  assert.equal(asyncGame.player(1).hand.length, 0);
  assert.equal(asyncGame.field.length, 0);
  assert.equal(batches.find(event => event.type === "cleanup").cardIds.length, 3);
  assert.ok(batches.some(event => event.type === "miss" && event.cause === "holyLight"));
  assert.equal(asyncGame.presentationEvents.length, 0);
  assert.equal(sync.presentationEvents.length, 0);
});

test("魔弹与多个中毒呈现顺序来自实际结算，伤害摸牌在爆牌弃置前", async () => {
  const game = new Game({ heroRules: false, shuffleDeck: false });
  hand(game, 0, "magicBullet"); hand(game, 1, "magicBullet");
  const events = [];
  game.enablePresentation(batch => events.push(...batch));
  await game.playMagicWithDecisions(0, 0, { chooseResponse: context => context.target.id === 1 ? { index: 0 } : null });
  assert.deepEqual(events.filter(event => event.type === "relay").map(event => [event.sourceId, event.playerId, event.amount]), [[0, 1, 2], [1, 3, 3]]);
  for (const card of game.deck.filter(card => card.name === "poison").slice(0, 2)) game.attachCard(card.id, 0, { effectId: "poison", sourcePlayerId: 1 });
  game.draw(0, 6);
  events.length = 0; game.presentationEvents.length = 0;
  await game.beginTurn(0);
  const types = events.map(event => event.type);
  assert.equal(events.filter(event => event.type === "effect" && event.effectId === "poison").length, 2);
  assert.ok(types.indexOf("damage") < types.indexOf("draw"));
  assert.ok(types.indexOf("draw") < types.indexOf("discard"));
  assert.equal(game.assertCardLocations(), true);
});


test("无牌也等待响应，攻击链牌留场至结算结束；伤害类别与暗弃可见性供规则查询", async () => {
  for (const [name, damageType] of [["waterStrike", "attack"], ["magicBullet", "spell"]]) {
    const game = new Game({ heroRules: false, shuffleDeck: false });
    const used = hand(game, 0, name), events = [], contexts = [];
    game.enablePresentation(batch => events.push(...batch));
    game.registerSkill("damageObserver", { timings: [Timing.DAMAGE_BEFORE, Timing.DAMAGE_AFTER], resolve: ({ context }) => contexts.push(context.damageType) });
    game.player(0).hero.addSkills("damageObserver");
    let release, asked = 0;
    const pending = game.playWithDecisions(0, 0, 1, { chooseResponse: ({ valid }) => {
      asked++; assert.deepEqual(valid, []); assert.equal(used.location.zone, "field");
      assert.equal(game.player(1).hand.length, 0);
      return new Promise(resolve => { release = resolve; });
    } });
    while (!release) await new Promise(resolve => setImmediate(resolve));
    assert.equal(asked, 1); assert.equal(events.some(event => event.type === "damage"), false);
    release(null); await pending;
    assert.deepEqual(contexts, [damageType, damageType]);
    assert.equal(events.find(event => event.type === "damage").damageType, damageType);
    assert.equal(used.location.zone, "discard"); assert.equal(used.discardVisibility, "public");
    assert.equal(game.field.length, 0);
    game.draw(1, 6, { overflow: "defer" }); events.length = 0; game.presentationEvents.length = 0;
    const discarded = game.resolveOverflow(1, [0, 1]);
    assert.ok(discarded.every(card => card.discardVisibility === "hidden"));
    assert.equal(game.presentationEvents.find(event => event.type === "discard").visibility, "hidden");
    assert.match(game.log.at(-1), /暗弃2张手牌/);
    assert.ok(!game.log.at(-1).includes("【"));
    game.moveCard(discarded[0].id, { zone: "deck" }); assert.equal(discarded[0].discardVisibility, null);
    assert.equal(game.assertCardLocations(), true);
  }
});

test("呈现快照保存动态治疗上限，后续变化不回写旧动画帧", () => {
  const game = new Game({ heroIds: ["plagueMage", "holyLancer", "priest", "saint", "valkyrie", "elementalist"] });
  game.enablePresentation();
  game.recordPresentation("checkpoint");
  const first = game.presentationEvents.at(-1).view;
  assert.deepEqual(first.players.slice(0, 3).map(p => p.healingLimit), [5, 3, 6]);
  game.teams.red.cups = 1;
  game.recordPresentation("checkpoint");
  assert.equal(game.presentationEvents.at(-1).view.players[1].healingLimit, 2);
  assert.equal(first.players[1].healingLimit, 3);
});
