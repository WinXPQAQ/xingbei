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

test("神箭手攻击响应：闪电箭禁止应战，精准射击仍执行时点2；贯穿射击是未命中响应", async () => {
  const lightning = make("marksman"); named(lightning, 0, "thunderStrike"); named(lightning, 1, "thunderStrike"); named(lightning, 1, "holyLight");
  named(lightning, 0, "poison");
  await lightning.attackWithDecisions(0, 0, 1, { chooseResponse: request => {
    assert.deepEqual(request.valid.map(item => item.card.name), ["holyLight"]); return { index: 1 };
  }, choose: request => request.type === "cardChoice" ? [0] : false });
  assert.equal(lightning.player(1).hand.length, 3);
  assert.equal(lightning.timeline.filter(entry => entry.timing === Timing.SPELL_ACTION_START).length, 0);
  assert.equal(lightning.discard.find(card => card.name === "poison").discardVisibility, "public");
  assert.match(lightning.log.join(" "), /2点法术伤害/);
  const precise = make("marksman"); take(precise, 0, card => card.hasUniqueSkill("precisionShot"));
  const shield = precise.deck.find(card => card.name === "holyShield"); precise.attachCard(shield.id, 1, { effectId: "holyShield" });
  let asked = 0;
  await precise.attackWithDecisions(0, 0, 1, { choose: request => request.skillId === "precisionShot", chooseResponse: () => { asked++; return null; } });
  assert.equal(asked, 0); assert.equal(precise.player(1).hand.length, 1); assert.equal(shield.location.zone, "status");
  assert.equal(precise.timeline.find(entry => entry.timing === Timing.ATTACK_HIT_CHECK).point, 2);
});

test("神箭手法术技能：闪光陷阱正常伤害，狙击直接补5、暗弃与可放弃攻击行动", async () => {
  const game = make("marksman"); const trap = take(game, 0, card => card.hasUniqueSkill("flashTrap"));
  await game.beginTurn(0);
  await assert.rejects(game.executeAction(0, { type: "skill", skillId: "flashTrap", cardIds: [], targetIds: [1] }), /费用/);
  assert.equal(trap.location.zone, "hand");
  await game.executeAction(0, { type: "skill", skillId: "flashTrap", cardIds: [trap.id], targetIds: [1] });
  assert.equal(game.player(1).hand.length, 2); assert.equal(trap.location.zone, "discard");
  game.assertCardLocations(); game.endTurn();
  const snipe = make("marksman"); snipe.player(0).handLimit = 4; snipe.player(0).energy.gem = 1;
  snipe.changeHealing(0, 2); await snipe.beginTurn(0);
  await snipe.executeAction(0, { type: "skill", skillId: "snipe", targetIds: [0] }, { overflow: "defer", resolveOverflow: request => {
    assert.equal(request.player.hand.length, 5); assert.equal(request.player.pendingOverflow.cause.type, "directDraw");
    snipe.resolveOverflow(0, [0], request.player.pendingOverflow);
  } });
  assert.equal(snipe.player(0).hand.length, 4); assert.equal(snipe.teams.red.morale, 14); assert.equal(snipe.player(0).healing, 2);
  assert.equal(snipe.discard[0].discardVisibility, "hidden"); assert.equal(snipe.player(0).energy.gem, 0);
  assert.equal(snipe.timeline.some(entry => entry.timing === Timing.DAMAGE_BEFORE), false);
  assert.equal(snipe.turn.hasExtraActions(), true); snipe.skipExtraActions(0); snipe.endTurn(); snipe.assertCardLocations();
});

test("封印师：独有技牌挂载为基础效果，使用/展示/明弃触发，暗弃与盖牌不触发", async () => {
  for (const exposure of ["play", "show", "public", "hidden", "covered"]) {
    const game = make("sealer"); const seal = take(game, 0, card => card.hasUniqueSkill("fireSeal"));
    const fire = named(game, 1, "fireStrike");
    await game.executeAction(0, { type: "skill", skillId: "fireSeal", cardIds: [seal.id], targetIds: [1] });
    assert.equal(seal.location.zone, "status"); assert.equal(game.player(1).getBasicEffects()[0], seal);
    assert.ok(!game.legalSkillActions(0).find(entry => entry.skillId === "fireSeal"));
    if (exposure === "play") await game.attackWithDecisions(1, 0, 0, { chooseResponse: () => null });
    else if (exposure === "show") {
      const { resolveAsync } = await import("../src/resolution/decisions.js");
      await resolveAsync(game.showCardsSteps(1, [fire]), request => request.defaultValue);
    } else {
      game.discardCards(1, [fire], { visibility: exposure === "hidden" ? "hidden" : "public", covered: exposure === "covered" });
      const { resolveAsync } = await import("../src/resolution/decisions.js");
      await resolveAsync(game.flushRuleEvents(), request => request.defaultValue);
    }
    assert.equal(seal.location.zone, ["hidden", "covered"].includes(exposure) ? "status" : "discard");
    assert.equal(game.log.some(line => line.includes("3点法术伤害")), !["hidden", "covered"].includes(exposure));
    game.assertCardLocations();
  }
});

test("五系束缚是独立场外实体，优先级中毒→束缚→虚弱，合并摸牌后回场外并可复用；封印破碎只收基础牌", async () => {
  const game = make("sealer"); const binding = game.cards.get(game.player(0).hero.state.bindingCardId);
  assert.equal(game.cards.size, 151); assert.equal(binding.location.zone, "outside");
  game.player(0).energy.crystal = 2;
  await game.executeAction(0, { type: "skill", skillId: "fivefoldBinding", targetIds: [1] });
  assert.equal(binding.category, "exclusive"); assert.equal(binding.location.zone, "status"); assert.equal(game.player(1).getBasicEffects().length, 0);
  assert.equal(game.legalSkillActions(0).some(entry => entry.skillId === "fivefoldBinding"), false);
  for (const element of ["earth", "water", "fire"]) {
    const seal = game.deck.find(card => card.hasUniqueSkill(`${element}Seal`)); game.attachCard(seal.id, 2, { effectId: `${element}Seal`, sourcePlayerId: 0 });
  }
  for (const name of ["poison", "weakness"]) { const card = game.deck.find(card => card.name === name); game.attachCard(card.id, 1, { effectId: name }); }
  const effectOrder = []; game.enablePresentation(events => { for (const event of events) if (event.type === "effect") effectOrder.push(event.effectId); });
  await game.beginTurn(1, { choose: request => request.type === "bindingChoice" ? "draw" : request.defaultValue });
  assert.deepEqual(effectOrder, ["poison", "fivefoldBinding"]); assert.equal(game.turn.state.skipped, false);
  assert.equal(game.player(1).hand.length, 6); assert.equal(game.teams.blue.morale, 13);
  assert.equal(game.player(1).statuses.length, 0); assert.equal(binding.location.zone, "outside"); game.endTurn();
  await game.beginTurn(0);
  const collected = game.player(2).getBasicEffects()[0];
  await game.executeAction(0, { type: "skill", skillId: "sealBreaking", targetIds: [2] }, { choose: request => request.type === "effectChoice" ? collected.id : request.defaultValue });
  assert.equal(collected.location.zone, "hand"); assert.equal(collected.attachment, null); assert.equal(game.player(0).energy.crystal, 0);
  game.endTurn(); game.assertCardLocations();
  const skipped = make("sealer"); skipped.player(0).energy.crystal = 1;
  await skipped.executeAction(0, { type: "skill", skillId: "fivefoldBinding", targetIds: [1] });
  const result = await skipped.beginTurn(1); assert.equal(result.skipped, true); assert.equal(skipped.outside.length, 1);
});
