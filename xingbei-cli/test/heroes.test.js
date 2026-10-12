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

test("守护天使移除基础效果并给治疗，不能移除专属；墙视为圣盾，天使之歌在回合开始前", async () => {
  const game = new Game({ seed: 13, heroIds: ["guardianAngel", "none", "none", "none", "sealer", "none"] });
  const binding = game.cards.get(game.player(4).hero.state.bindingCardId); game.attachCard(binding.id, 1, { effectId: "fivefoldBinding", sourcePlayerId: 4 });
  named(game, 0, "windStrike");
  assert.equal(game.legalSkillActions(0).some(entry => entry.skillId === "windCleansing"), false);
  const poison = game.deck.find(card => card.name === "poison"); game.attachCard(poison.id, 1, { effectId: "poison" });
  await game.executeAction(0, { type: "skill", skillId: "windCleansing", cardIds: [game.player(0).hand[0].id], targetIds: [1] });
  assert.equal(poison.location.zone, "discard"); assert.equal(binding.location.zone, "status"); assert.equal(game.player(0).healing, 1);
  const wall = take(game, 0, card => card.hasUniqueSkill("angelWall"));
  await game.executeAction(0, { type: "skill", skillId: "angelWall", cardIds: [wall.id], targetIds: [2] });
  assert.equal(game.player(0).healing, 2); assert.equal(wall.attachment.effectId, "holyShield");
  named(game, 3, "fireStrike"); await game.attackWithDecisions(3, 0, 2, { chooseResponse: () => null });
  assert.equal(wall.location.zone, "discard"); assert.equal(game.player(2).hand.length, 0);
  const song = make("guardianAngel"); song.player(0).energy.crystal = 1;
  const ownPoison = song.deck.find(card => card.name === "poison"); song.attachCard(ownPoison.id, 0, { effectId: "poison" });
  await song.beginTurn(0, { choose: request => request.type === "skillChoice" ? true : request.defaultValue });
  assert.equal(song.player(0).energy.crystal, 0); assert.equal(song.player(0).healing, 1); assert.equal(ownPoison.location.zone, "discard");
  assert.equal(song.timeline[0].timing, Timing.TURN_BEFORE); assert.equal(song.timeline.some(entry => entry.timing === Timing.DAMAGE_BEFORE), false);
  game.assertCardLocations(); song.assertCardLocations();
});

test("天使祝福单目标给2、双目标各给1，转移手牌不触发封印、不复制牌", async () => {
  for (const targetIds of [[3], [3, 4]]) {
    const game = make("guardianAngel"), water = named(game, 0, "waterStrike");
    named(game, 3, "fireStrike"); named(game, 3, "earthStrike"); named(game, 4, "holyLight");
    const seal = game.deck.find(card => card.hasUniqueSkill("fireSeal")); game.attachCard(seal.id, 3, { effectId: "fireSeal", sourcePlayerId: 1 });
    await game.executeAction(0, { type: "skill", skillId: "angelBlessing", cardIds: [water.id], targetIds });
    assert.equal(game.player(0).hand.length, 2); assert.equal(seal.location.zone, "status");
    assert.equal(game.player(3).hand.length, targetIds.length === 1 ? 0 : 1); game.assertCardLocations();
  }
});

test("神之庇护只抵御己方法术伤害的爆牌士气，伤害摸牌与暗弃不变；可拒绝且宝石可替水晶", async () => {
  for (const [damageType, accepted] of [["spell", true], ["spell", false], ["attack", true]]) {
    const game = make("guardianAngel"); game.player(3).handLimit = 1; named(game, 3, "holyLight"); game.player(0).energy = { gem: 1, crystal: 1 };
    let requested = 0;
    const { resolveAsync } = await import("../src/resolution/decisions.js");
    await resolveAsync(game.damageSteps(3, 2, { sourceId: 1, damageType, choose: request => request.defaultValue }), request => {
      if (request.type === "numberChoice") { requested++; return accepted ? 2 : 0; } return request.defaultValue;
    });
    assert.equal(requested, damageType === "spell" ? 1 : 0);
    assert.equal(game.teams.red.morale, damageType === "spell" && accepted ? 15 : 13);
    assert.equal(game.player(3).hand.length, 1); assert.equal(game.discard.length, 2); assert.ok(game.discard.every(card => card.discardVisibility === "hidden"));
    assert.equal(game.player(0).energy.gem + game.player(0).energy.crystal, damageType === "spell" && accepted ? 0 : 2);
    game.assertCardLocations();
  }
  const deferred = make("guardianAngel"); deferred.player(3).handLimit = 1; deferred.player(0).energy.crystal = 1;
  deferred.onDecision = async request => request.type === "numberChoice" ? 1 : request.defaultValue;
  const { resolveAsync } = await import("../src/resolution/decisions.js");
  await resolveAsync(deferred.damageSteps(3, 2, { sourceId: 1, damageType: "spell", overflow: "defer" }), request => request.type === "overflow" ? deferred.resolveOverflowWithDecisions(3, [0]) : request.defaultValue);
  assert.equal(deferred.teams.red.morale, 15); assert.equal(deferred.player(0).energy.crystal, 0); deferred.assertCardLocations();
  const direct = make("guardianAngel"); direct.player(3).handLimit = 1; direct.player(0).energy.crystal = 2;
  direct.draw(3, 3); assert.equal(direct.teams.red.morale, 13); assert.equal(direct.player(0).energy.crystal, 2);
});

test("神官治疗上限6、防御每次最多1、祈福明弃与启示特殊行动结束", async () => {
  const game = make("priest"); assert.equal(game.getHealingLimit(0), 6); assert.equal(game.getHealingLimit(1), 2);
  game.changeHealing(0, 8); assert.equal(game.player(0).healing, 6);
  const { resolveAsync } = await import("../src/resolution/decisions.js");
  await resolveAsync(game.damageSteps(0, 3, { sourceId: 1, damageType: "spell" }), request => {
    if (request.type === "healing") { assert.deepEqual(request.choices.map(choice => choice.value), [0, 1]); return 1; } return request.defaultValue;
  });
  assert.equal(game.player(0).healing, 5); assert.equal(game.player(0).hand.length, 2);
  await assert.rejects(resolveAsync(game.damageSteps(0, 2), request => request.type === "healing" ? 2 : request.defaultValue), /治疗/);
  while (game.player(0).hand.length) game.moveCard(game.player(0).hand[0].id, { zone: "deck" });
  const cards = [named(game, 0, "holyLight"), named(game, 0, "poison")];
  await game.executeAction(0, { type: "skill", skillId: "prayer", cardIds: cards.map(card => card.id), targetIds: [] });
  assert.equal(game.player(0).healing, 6); assert.ok(cards.every(card => card.discardVisibility === "public"));
  const sync = make("priest"); sync.startTurn(0); sync.purchase(0, { skillChoices: { revelation: true } });
  assert.equal(sync.player(0).healing, 1);
  game.changeHealing(0, -6); await game.beginTurn(0);
  await game.executeAction(0, { type: "purchase" }, { choose: request => request.skillId === "revelation" });
  assert.equal(game.player(0).healing, 1); assert.equal(game.timeline.filter(entry => entry.timing === Timing.SPECIAL_ACTION_END).length, 1); game.assertCardLocations();
});

test("神圣契约启动一次、队友可超过普通治疗上限；启动改变费用后允许重选，领域暗弃不触发封印", async () => {
  const game = make("priest"); game.changeHealing(0, 6); game.player(0).energy.crystal = 2; game.changeHealing(3, 1);
  const cards = [named(game, 0, "holyLight"), named(game, 0, "poison")]; await game.beginTurn(0);
  await game.executeAction(0, { type: "skill", skillId: "sacredDomain", cardIds: cards.map(card => card.id), targetIds: [3], mode: "heal" }, { choose: request => request.type === "skillChoice" ? true : request.type === "playerChoice" ? 3 : request.type === "numberChoice" ? 3 : request.defaultValue });
  assert.equal(game.player(0).healing, 5); assert.equal(game.player(3).healing, 4); assert.equal(game.player(0).energy.crystal, 0);
  assert.ok(cards.every(card => card.discardVisibility === "hidden"));
  game.changeHealing(3, 1); assert.equal(game.player(3).healing, 4); game.changeHealing(3, -1); assert.equal(game.player(3).healing, 3);
  game.changeHealing(3, 1); assert.equal(game.player(3).healing, 3); game.assertCardLocations();
  const changed = make("priest"); changed.changeHealing(0, 1); changed.player(0).energy.crystal = 1;
  const costs = [named(changed, 0, "holyLight"), named(changed, 0, "poison")]; await changed.beginTurn(0);
  await assert.rejects(changed.executeAction(0, { type: "skill", skillId: "sacredDomain", mode: "damage", cardIds: costs.map(card => card.id), targetIds: [1] }, { choose: request => request.type === "skillChoice" ? true : request.defaultValue }), /重新选择/);
  assert.equal(changed.turn.state.actionType, null); assert.equal(changed.player(0).hand.length, 2);
  await changed.executeAction(0, { type: "skill", skillId: "prayer", cardIds: costs.map(card => card.id), targetIds: [] });
  assert.equal(changed.timeline.filter(entry => entry.timing === Timing.ACTIVATION).length, 1);
  const damage = make("priest"); damage.changeHealing(0, 1); damage.player(0).energy.gem = 1;
  const fire = named(damage, 0, "fireStrike"), other = named(damage, 0, "holyLight");
  const seal = damage.deck.find(card => card.hasUniqueSkill("fireSeal")); damage.attachCard(seal.id, 0, { effectId: "fireSeal", sourcePlayerId: 1 });
  await damage.executeAction(0, { type: "skill", skillId: "sacredDomain", mode: "damage", cardIds: [fire.id, other.id], targetIds: [1] });
  assert.equal(seal.location.zone, "status"); assert.equal(damage.player(1).hand.length, 2); assert.equal(damage.player(0).healing, 0);
});

test("水之神力强制转移手牌、治疗和爆牌，最后一张水牌沿用原版无剩余手牌时跳过给牌", async () => {
  for (const remaining of [false, true]) {
    const game = make("priest"), water = named(game, 0, "waterStrike");
    if (remaining) named(game, 0, "holyLight");
    game.player(3).handLimit = 0;
    await game.executeAction(0, { type: "skill", skillId: "waterPower", cardIds: [water.id], targetIds: [3] });
    assert.equal(game.player(0).healing, 1); assert.equal(game.player(3).healing, 1); assert.equal(game.player(0).hand.length, 0);
    assert.equal(game.teams.red.morale, remaining ? 14 : 15); game.assertCardLocations();
  }
});

test("六英雄默认阵容完整AI对局：逐回合、额外行动、实例守恒与结束", async () => {
  const { chooseAiAction, chooseAiResponse, chooseAiRuleDecision } = await import("../src/ai.js");
  for (const seed of [1, 13, 71]) {
    const game = new Game({ seed }).setup();
    assert.deepEqual(game.players.map(player => player.hero.id), ["berserker", "windSwordmaster", "marksman", "sealer", "guardianAngel", "priest"]);
    game.onDecision = request => chooseAiRuleDecision(request);
    let turns = 0;
    const options = { overflow: "random", choose: game.onDecision, chooseResponse: request => chooseAiResponse(game, request) };
    while (!game.winner && turns++ < 500) {
      const id = game.current;
      const turn = await game.beginTurn(id, { choose: game.onDecision, chooseWeakness: () => "skip" }, options);
      if (!turn.skipped && !game.winner) {
        let actions = 0;
        do {
          assert.ok(++actions < 20, "每回合额外行动有界");
          const action = chooseAiAction(game, id);
          if (action.type !== "pass") await game.executeAction(id, action, options);
          else if (game.turn.hasExtraActions()) game.skipExtraActions(id);
          game.assertCardLocations();
        } while (game.turn.hasExtraActions() && !game.winner);
      }
      await game.endTurnWithDecisions(options); game.assertCardLocations();
      assert.equal(game.cards.size, 151);
    }
    assert.ok(game.winner, `种子${seed}应在500回合内结束`);
  }
});


test("开局自由选已实现角色：交换阵容、固定六人坐次，生成正确专属牌且拒绝非法设置", async () => {
  const { getAvailableHeroes, createHeroRoster } = await import("../src/hero.js");
  assert.equal(getAvailableHeroes().length, 6);
  for (const { id } of getAvailableHeroes()) {
    const game = new Game({ seed: 13, playerHeroId: id }).setup();
    assert.equal(game.player(0).hero.id, id);
    assert.equal(new Set(game.players.map(player => player.hero.id)).size, 6);
    assert.deepEqual(game.players.map(player => player.team), ["red", "blue", "blue", "red", "red", "blue"]);
    assert.ok(game.players.every(player => player.hand.length === 4));
    const sealer = game.players.find(player => player.hero.id === "sealer");
    assert.equal(game.outside.length, 1); assert.equal(game.outside[0].id, sealer.hero.state.bindingCardId);
    game.assertCardLocations();
  }
  assert.equal(createHeroRoster("guardianAngel", 2)[2], "guardianAngel");
  assert.throws(() => new Game({ playerHeroId: "unknown" }), /角色/);
  assert.throws(() => new Game({ playerHeroId: "priest", playerSeat: 6 }), /座位/);
  assert.throws(() => new Game({ playerHeroId: "priest", heroIds: [] }), /同时/);
});
