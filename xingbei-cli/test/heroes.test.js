import test from "node:test";
import assert from "node:assert/strict";
import { Game, Timing } from "../src/engine.js";
const make = id => new Game({ seed: 13, shuffleDeck: false, heroIds: [id, "none", "none", "none", "none", "none"] });
const take = (game, playerId, predicate) => game.moveCard(game.deck.find(predicate).id, { zone: "hand", playerId });
const named = (game, id, name) => take(game, id, card => card.name === name);

test("独有技逐张还原：150张实体、圣光治疗术、相同属性命格不同标签", () => {
  const game = make("berserker");
  assert.equal(game.cards.size, 150);
  assert.equal(game.deck.filter(card => card.name === "holyLight" && card.hasUniqueSkill("healingArt")).length, 3);
  const wind = game.deck.filter(card => card.element === "wind" && card.fate === "J");
  assert.equal(wind.filter(card => card.hasUniqueSkill("stormArt")).length, 2);
  assert.equal(wind.filter(card => card.hasUniqueSkill("galeArt")).length, 3);
  assert.ok(wind.every(card => Object.isFrozen(card.uniqueSkills)));
});

test("狂战士完整链：增伤在正确时点，撕裂可拒绝；主动与应战有区别", async () => {
  for (const extra of [false, true]) {
    const game = make("berserker");
    take(game, 0, card => card.hasUniqueSkill("bloodBlade"));
    for (let i = 0; i < 4; i++) named(game, 0, "holyLight");
    named(game, 1, "poison"); named(game, 1, "weakness");
    game.player(0).energy.gem = 1;
    await game.attackWithDecisions(0, 0, 1, { chooseResponse: () => null, choose: request => request.skillId === "bloodBlade" || (request.skillId === "rend" && extra) });
    assert.equal(game.player(1).hand.length, 6);
    assert.equal(game.player(0).energy.gem, extra ? 0 : 1);
    const expected = [Timing.ATTACK_DECLARED, Timing.ATTACK_DECISION, Timing.DAMAGE_BEFORE, Timing.HEALING_BEFORE, Timing.DAMAGE_ACTUAL_BEFORE, Timing.DAMAGE_ACTUAL];
    assert.deepEqual(game.timeline.filter(entry => expected.includes(entry.timing)).map(entry => entry.point), [1, 2, 3, 4, 5, 6]);
    assert.match(game.log.join(" "), new RegExp(`承受${extra ? 8 : 6}点攻击伤害`));
    assert.equal(game.field.length, 0); game.assertCardLocations();
  }
  const game = make("berserker");
  named(game, 1, "fireStrike"); named(game, 0, "fireStrike");
  await game.attackWithDecisions(1, 0, 0, { chooseResponse: request => request.target.id === 0 ? { index: 0, targetId: 2 } : null });
  assert.equal(game.player(2).hand.length, 3, "狂化也增强应战攻击");
  const before = game.player(2).hand.length;
  game.damage(2, 1, { sourceId: 0, damageType: "spell" }); assert.equal(game.player(2).hand.length, before + 1);
});

test("血腥咆哮在时点2命中，圣光和圣盾保留，治疗仍在时点4抵挡", async () => {
  const game = make("berserker");
  const card = take(game, 0, card => card.hasUniqueSkill("bloodyRoar"));
  named(game, 1, "holyLight");
  const shield = game.deck.find(card => card.name === "holyShield"); game.attachCard(shield.id, 1, { effectId: "holyShield" });
  game.changeHealing(1, 2); let responses = 0;
  await game.attackWithDecisions(0, 0, 1, { chooseResponse: () => { responses++; return null; }, choose: request => request.skillId === "bloodyRoar" ? true : request.type === "healing" ? 2 : false });
  assert.equal(responses, 0); assert.equal(game.player(1).healing, 0);
  assert.equal(shield.location.zone, "status"); assert.equal(game.player(1).hand.length, 2);
  assert.equal(card.location.zone, "discard");
  assert.equal(game.timeline.find(entry => entry.timing === Timing.ATTACK_HIT_CHECK).point, 2);
});

test("风之剑圣连续三次主动攻击、额外行动可结束、圣剑摸弃与回合限定", async () => {
  const game = make("windSwordmaster");
  for (let i = 0; i < 3; i++) take(game, 0, card => card.type === "attack" && card.hasUniqueSkill("galeArt"));
  game.player(0).energy.crystal = 1;
  await game.beginTurn(0);
  const options = { chooseResponse: () => null, choose: request => request.type === "skillChoice" ? ["galeArt", "swordShadow"].includes(request.skillId) : request.type === "numberChoice" ? 1 : request.defaultValue };
  await game.attackWithDecisions(0, 0, 1, options);
  assert.equal(game.turn.state.pendingActions.length, 2); assert.equal(game.turn.state.usedSkills.swordShadow, true);
  await game.attackWithDecisions(0, 0, 2, options);
  const shield = game.deck.find(card => card.name === "holyShield"); game.attachCard(shield.id, 5, { effectId: "holyShield" });
  let asked = 0;
  await game.attackWithDecisions(0, 0, 5, { ...options, chooseResponse: () => { asked++; return null; } });
  assert.equal(asked, 0); assert.equal(shield.location.zone, "status");
  assert.equal(game.turn.state.attackCount, 3); assert.equal(game.player(0).hand.length, 0);
  assert.equal(game.player(0).energy.crystal, 0);
  assert.equal(game.timeline.filter(entry => entry.timing === Timing.ACTIVATION).length, 1);
  assert.equal(game.timeline.filter(entry => entry.timing === Timing.ATTACK_ACTION_END).length, 3);
  game.skipExtraActions(0); assert.equal(game.turn.hasExtraActions(), false);
  await game.endTurnWithDecisions(); assert.equal(game.current, 1); game.assertCardLocations();
});

test("风怒限制风系，烈风技允许圣光而不消耗圣盾，取消可选技能不扣费", async () => {
  const game = make("windSwordmaster");
  named(game, 0, "waterStrike"); named(game, 0, "windStrike"); named(game, 0, "earthStrike");
  await game.beginTurn(0);
  await game.attackWithDecisions(0, 0, 1, { chooseResponse: () => null, choose: request => request.skillId === "windFury" });
  assert.ok(game.legalCards(0).every(action => action.card.element === "wind"));
  game.skipExtraActions(0); game.endTurn();
  const storm = make("windSwordmaster"); take(storm, 0, card => card.hasUniqueSkill("stormArt"));
  named(storm, 1, "holyLight"); named(storm, 1, "windStrike");
  const shield = storm.deck.find(card => card.name === "holyShield"); storm.attachCard(shield.id, 1, { effectId: "holyShield" });
  await storm.attackWithDecisions(0, 0, 1, { choose: request => request.skillId === "stormArt", chooseResponse: request => {
    assert.deepEqual(request.valid.map(item => item.card.name), ["holyLight"]); return { index: 0 };
  } });
  assert.equal(shield.location.zone, "status"); assert.equal(storm.player(1).hand.length, 1);
});
