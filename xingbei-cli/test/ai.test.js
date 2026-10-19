import test from "node:test";
import assert from "node:assert/strict";
import { getPolicy } from "../src/ai/versions.js";
import { Game } from "../src/engine.js";
import { chooseAiAction, rankAiActions, chooseAiRuleDecision, chooseAiDiscard, keepCards, cardScore, planWindAttacks, runAiAction } from "../src/ai.js";

const make = heroId => new Game({ seed: 13, shuffleDeck: false, playerHeroId: heroId });
const take = (game, id, predicate) => {
  const card = game.deck.find(typeof predicate === "string" ? card => card.name === predicate : predicate);
  assert.ok(card, "fixture card exists");
  return game.moveCard(card.id, { zone: "hand", playerId: id });
};
const offer = (game, skillId, context = {}) => chooseAiRuleDecision({ type: "skillChoice", playerId: 0, skillId, context, energy: game.player(0).energy, reservedEnergy: 0 }, game);

test("AI提炼：通常必须2颗；容量只有1也不提炼，神官和风剑例外必须有实际用途", () => {
  for (const hero of ["berserker", "windSwordmaster", "marksman", "sealer", "guardianAngel", "priest"]) {
    const game = make(hero); game.addStones("red", "gem", 1);
    assert.ok(!rankAiActions(game, 0).some(entry => entry.action.type === "refine"));
    game.addStones("red", "crystal", 1);
    assert.deepEqual(rankAiActions(game, 0).find(entry => entry.action.type === "refine").action.stones, { gem: 1, crystal: 1 });
    game.player(0).energy.crystal = 2;
    assert.ok(!rankAiActions(game, 0).some(entry => entry.action.type === "refine"));
  }
  const priest = make("priest"); priest.player(0).healing = 1; priest.teams.blue.morale = 2;
  take(priest, 0, "poison"); take(priest, 0, "weakness");
  for (let n = 0; n < 6; n++) take(priest, 1, card => card.type === "attack");
  priest.addStones("red", "crystal", 1);
  assert.equal(chooseAiAction(priest, 0).type, "refine");
  priest.player(1).healing = 2;
  assert.ok(!rankAiActions(priest, 0).some(entry => entry.action.type === "refine"));
  const wind = make("windSwordmaster");
  take(wind, 0, card => card.name === "fireStrike" && !card.hasUniqueSkill("galeArt"));
  take(wind, 0, card => card.name === "earthStrike" && !card.hasUniqueSkill("galeArt"));
  take(wind, 0, card => card.name === "windStrike" && !card.hasUniqueSkill("galeArt"));
  wind.addStones("red", "gem", 1);
  assert.equal(chooseAiAction(wind, 0).type, "refine");
});

test("冻结v1.1风剑搜索并实际执行三刀：风系疾风技第二刀，无需剑影；不足三刀不浪费疾风/能量", () => {
  const policy=getPolicy("v1.1");
  const {runAiAction,planWindAttacks,chooseAiRuleDecision}=policy;
  const chooseAiAction=(g,id)=>policy.chooseAiAction(g,id);
  const offer=(game,skillId,context={})=>chooseAiRuleDecision({type:"skillChoice",playerId:0,skillId,context,energy:game.player(0).energy,reservedEnergy:0},game);
  const game = make("windSwordmaster");
  const first = take(game, 0, card => card.name === "fireStrike" && !card.hasUniqueSkill("galeArt"));
  const gale = take(game, 0, card => card.element === "wind" && card.hasUniqueSkill("galeArt"));
  const last = take(game, 0, card => card.name === "earthStrike" && !card.hasUniqueSkill("galeArt"));
  game.player(0).energy.crystal = 1;
  game.startTurn(0);
  assert.deepEqual(planWindAttacks(game, 0).steps, [first.id, gale.id, last.id]);
  const played = [];
  do {
    const action = chooseAiAction(game, 0); assert.equal(action.type, "play");
    played.push(game.player(0).hand[action.index].id); runAiAction(game, 0, { autoRespond: false });
  } while (game.turn.hasExtraActions());
  assert.deepEqual(played, [first.id, gale.id, last.id]);
  assert.equal(game.turn.state.attackCount, 3); assert.equal(game.player(0).energy.crystal, 1);
  assert.ok(game.timeline.some(entry => entry.timing === "attackDecision" && entry.point === 2));
  game.assertCardLocations();
  const short = make("windSwordmaster");
  const card = take(short, 0, card => card.element !== "wind" && card.hasUniqueSkill("galeArt"));
  take(short, 0, "earthStrike"); short.player(0).energy.crystal = 1; short.startTurn(0);
  short.moveCard(card.id, { zone: "field" }); short.turn.state.attackCount = 1;
  assert.equal(offer(short, "galeArt", { card }), false);
  assert.equal(offer(short, "swordShadow"), false);
});

test("风剑非风疾风技先出，额外风行动先消耗；没有连击条件首刀保留风", () => {
  const game = make("windSwordmaster");
  const gale = take(game, 0, card => card.hasUniqueSkill("galeArt") && card.element !== "wind");
  const wind = take(game, 0, card => card.element === "wind" && !card.hasUniqueSkill("galeArt"));
  const earth = take(game, 0, card => card.element === "earth" && !card.hasUniqueSkill("galeArt"));
  assert.deepEqual(planWindAttacks(game, 0).steps, [gale.id, earth.id, wind.id]);
  game.moveCard(gale.id, { zone: "discard" });
  assert.equal(game.player(0).hand[rankAiActions(game, 0).find(entry => entry.action.type === "play").action.index].id, earth.id);
});

test("天使选友方、要牌低优先度，移除有害基础效果；封印师先法术后攻击", () => {
  const angel = make("guardianAngel");
  const wall = take(angel, 0, card => card.hasUniqueSkill("angelWall"));
  take(angel, 0, "waterStrike"); take(angel, 3, "earthStrike");
  const ranked = rankAiActions(angel, 0);
  assert.ok(ranked.filter(entry => ["angelWall", "angelBlessing"].includes(entry.action.skillId)).every(entry => entry.action.targetIds.every(id => angel.player(id).team === "red")));
  assert.equal(ranked[0].action.skillId, "angelWall");
  assert.equal(ranked[0].action.cardIds[0], wall.id);
  assert.equal(angel.player(chooseAiRuleDecision({ type: "playerChoice", playerId: 0, choices: angel.players.map(player => ({ value: player.id })) }, angel)).team, "red");
  const sealer = make("sealer"); take(sealer, 0, "poison"); take(sealer, 0, "fireStrike");
  sealer.startTurn(0); const action = runAiAction(sealer, 0, { autoRespond: false });
  assert.equal(action.type, "play"); assert.equal(sealer.discard.some(card => card.name === "fireStrike"), false);
  assert.equal(sealer.turn.hasExtraActions(), true);
  assert.equal(chooseAiAction(sealer, 0).type, "play");
});

test("神官分牌同时比较费用、受益队友和牌；满手队友不作为分牌目标", () => {
  const game = make("priest");
  const water = take(game, 0, "waterStrike");
  const seal = take(game, 0, card => card.hasUniqueSkill("earthSeal"));
  const wall = take(game, 0, card => card.hasUniqueSkill("angelWall"));
  const candidates = rankAiActions(game, 0).filter(entry => entry.action.skillId === "waterPower");
  assert.ok(candidates.length);
  const give = recipientId => chooseAiRuleDecision({ type: "cardChoice", playerId: 0, purpose: "give", recipientId, count: 1, valid: [1, 2] }, game);
  assert.deepEqual(give(3), [1]); assert.deepEqual(give(4), [2]);
  for (let n = 0; n < 6; n++) take(game, 3, card => card.type === "attack");
  assert.ok(rankAiActions(game, 0).filter(entry => entry.action.skillId === "waterPower").every(entry => !entry.action.targetIds.includes(3)));
  assert.equal(water.location.zone, "hand"); assert.equal(seal.location.zone, "hand"); assert.equal(wall.location.zone, "hand");
});

test("留牌：暗灭和第一张圣光优先，额外圣光降值；狂战风剑普通法术最低", () => {
  for (const hero of ["berserker", "windSwordmaster", "marksman", "sealer", "guardianAngel", "priest"]) {
    const game = make(hero), cards = [take(game, 0, "darkStrike"), take(game, 0, "holyLight"), take(game, 0, "holyLight"), take(game, 0, "fireStrike"), take(game, 0, "fireStrike"), take(game, 0, "weakness"), take(game, 0, "poison")];
    const kept = keepCards(game, 0, cards, 5);
    assert.ok(kept.includes(cards[0])); assert.ok(kept.some(card => card.name === "holyLight"));
    assert.ok(cardScore(game, 0, cards[1]) > cardScore(game, 0, cards[2], [cards[1]]));
    if (["berserker", "windSwordmaster"].includes(hero)) assert.ok(cardScore(game, 0, cards[4], [cards[3]]) > cardScore(game, 0, cards[5]));
  }
});

test("神箭手/封印师保留至少2攻击和有限法术，专属留牌与天使风水、神官水有角色差异", () => {
  for (const hero of ["marksman", "sealer"]) {
    const game = make(hero);
    const cards = [take(game, 0, "holyLight"), take(game, 0, "fireStrike"), take(game, 0, "fireStrike"), take(game, 0, "weakness"), take(game, 0, "holyShield"), take(game, 0, "magicBullet"), take(game, 0, "poison"), take(game, 0, "weakness")];
    const kept = keepCards(game, 0, cards, 6);
    assert.ok(kept.filter(card => card.type === "attack").length >= 2);
    assert.ok(kept.filter(card => card.type === "spell" && card.name !== "holyLight").length <= 3);
  }
  for (const hero of ["guardianAngel", "priest"]) {
    const game = make(hero), water = take(game, 0, "waterStrike"), ordinary = take(game, 0, card => card.name === "fireStrike" && !card.hasUniqueSkill("angelWall"));
    assert.ok(cardScore(game, 0, water) > cardScore(game, 0, ordinary));
  }
});

test("神官留牌按下一轮前敌方强攻角色调整：2法术后防御多样性优先", () => {
  const game = new Game({ seed: 13, shuffleDeck: false, heroIds: ["priest", "windSwordmaster", "marksman", "sealer", "guardianAngel", "none"] });
  const spells = [take(game, 0, "poison"), take(game, 0, "magicBullet"), take(game, 0, "weakness")];
  const attack = take(game, 0, card => card.name === "earthStrike" && !card.hasUniqueSkill("earthSeal"));
  game.current = 1; // Enemy wind swordmaster acts before seat 0.
  assert.ok(cardScore(game, 0, spells[1], [spells[0]]) > cardScore(game, 0, attack));
  assert.ok(cardScore(game, 0, attack, spells.slice(0, 2)) > cardScore(game, 0, spells[2], spells.slice(0, 2)));
  game.current = 4; // No opposing berserker/wind swordsman before our next turn.
  assert.ok(cardScore(game, 0, spells[2], spells.slice(0, 2)) > cardScore(game, 0, attack, spells.slice(0, 2)));
});

test("撕裂只在新增士气损失时消耗宝石；神箭手高手机会、贯穿弃牌和治疗按收益决策", () => {
  const game = make("berserker"); game.player(0).energy.gem = 1;
  assert.equal(offer(game, "rend", { targetId: 1, amount: 3 }), false);
  for (let n = 0; n < 4; n++) take(game, 1, "poison");
  assert.equal(offer(game, "rend", { targetId: 1, amount: 3 }), true);
  const archer = make("marksman"); take(archer, 0, "thunderStrike"); take(archer, 0, "poison");
  for (let n = 0; n < 5; n++) take(archer, 2, "poison");
  const attacks = rankAiActions(archer, 0).filter(entry => entry.action.type === "play" && archer.player(0).hand[entry.action.index].type === "attack");
  assert.equal(attacks[0].action.targetId, 2);
  const request = { type: "cardChoice", playerId: 0, skillId: "piercingShot", context: { targetId: 2 }, optional: true, count: 1, valid: [1] };
  assert.deepEqual(chooseAiRuleDecision(request, archer), [1]);
  request.context.targetId = 1; assert.equal(chooseAiRuleDecision(request, archer), null);
});

test("AI爆牌实际使用牌值，隐藏弃牌保留规则；决策确定且不读取别人的手牌内容", () => {
  const game = make("berserker");
  const dark = take(game, 0, "darkStrike"), light = take(game, 0, "holyLight");
  for (let n = 0; n < 5; n++) take(game, 0, "poison");
  const discard = chooseAiDiscard(game, 0, 1); assert.equal(game.player(0).hand[discard[0]].name, "poison");
  game.draw(0, 0, { overflow: "ai" });
  assert.equal(dark.location.zone, "hand"); assert.equal(light.location.zone, "hand");
  assert.equal(game.discard.at(-1).discardVisibility, "hidden");
  const random = game.random; game.random = () => { throw new Error("AI must not sample random"); };
  for (const player of game.players.slice(1)) player.hand = new Proxy(player.hand, { get(target, key) { if (key !== "length") throw new Error("AI must not inspect another hand"); return target.length; } });
  assert.deepEqual(chooseAiAction(game, 0), chooseAiAction(game, 0));
  game.random = random;
});

test("神官启动为已计划的神圣领域保留治疗和能量，防止契约令行动失效", async () => {
  const game = make("priest");
  take(game, 0, "poison"); take(game, 0, "weakness");
  for (let n = 0; n < 6; n++) take(game, 1, card => card.type === "attack");
  for (let n = 0; n < 4; n++) take(game, 3, card => card.type === "attack");
  game.player(0).energy.crystal = 2; game.player(0).healing = 2;
  game.teams.blue.morale = 2; game.startTurn(0);
  const action = chooseAiAction(game, 0);
  assert.equal(action.skillId, "sacredDomain"); assert.equal(action.mode, "damage");
  await game.executeAction(0, action, { overflow: "ai", choose: request => chooseAiRuleDecision(request, game) });
  assert.equal(game.player(3).healing, 1, "契约只能转移领域以外的治疗");
  assert.equal(game.player(0).energy.crystal, 0); assert.equal(game.player(0).healing, 0);
  assert.equal(game.winner, "red"); game.assertCardLocations();
});

test("六角色决策不读其他手牌/牌库、不中途改状态；禁用英雄技能时不规划虚构追击", () => {
  for (const hero of ["berserker", "windSwordmaster", "marksman", "sealer", "guardianAngel", "priest"]) {
    const game = make(hero);
    for (const name of ["waterStrike", "windStrike", "fireStrike", "holyLight", "weakness"]) take(game, 0, name);
    game.player(0).energy.crystal = 1;
    const before = JSON.stringify(game.player(0));
    game.random = () => { throw new Error("AI cannot sample RNG"); };
    const protect = hand => new Proxy(hand, { get(target, key) { if (key !== "length") throw new Error("Private cards are hidden"); return target.length; } });
    game.deck = protect(game.deck);
    for (const player of game.players.slice(1)) player.hand = protect(player.hand);
    assert.deepEqual(chooseAiAction(game, 0), chooseAiAction(game, 0));
    assert.equal(JSON.stringify(game.player(0)), before);
  }
  const game = new Game({ heroRules: false, playerHeroId: "windSwordmaster" });
  take(game, 0, card => card.hasUniqueSkill("galeArt")); take(game, 0, "windStrike"); take(game, 0, "earthStrike");
  assert.equal(planWindAttacks(game, 0).count, 1);
});

test("v1.2风剑执行合法三刀并允许放弃冗余额外行动，保留冻结候选费用行为",()=>{
 const g=make('windSwordmaster');
 take(g,0,c=>c.name==='fireStrike'&&!c.hasUniqueSkill('galeArt'));
 take(g,0,c=>c.element==='wind'&&c.hasUniqueSkill('galeArt'));
 take(g,0,c=>c.name==='earthStrike'&&!c.hasUniqueSkill('galeArt'));
 g.player(0).energy.crystal=1;g.startTurn(0);
 const actions=[];
 do {actions.push(runAiAction(g,0,{autoRespond:false}));g.assertCardLocations();assert.ok(actions.length<=4);} while(g.turn.hasExtraActions());
 assert.deepEqual(actions.map(a=>a.type),['play','play','play','pass']);
 assert.equal(g.turn.state.attackCount,3);assert.equal(g.player(0).energy.crystal,0);
});
