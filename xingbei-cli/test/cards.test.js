import test from "node:test";
import assert from "node:assert/strict";
import { createDeck, createBasicCard, compareHandCards, ATTACKS } from "../src/cards.js";
import { Game, RuleError } from "../src/engine.js";
import { getPolicy } from "../src/ai/versions.js";
const legacy = getPolicy("v1.2");
const chooseAiAction = (...args) => legacy.chooseAiAction(...args);
const rankAiActions = (...args) => legacy.rankAiActions(...args);

const card = (name, element = "water", fate = "J", id = Math.random().toString()) => createBasicCard({ id, name, element, fate });

function appendHand(game, playerId, ...cards) {
  for (const card of cards) {
    game.registerCard(card, { zone: "deck" });
    game.moveCard(card.id, { zone: "hand", playerId });
  }
}
function setHand(game, playerId, cards) {
  for (const card of [...game.player(playerId).hand]) game.moveCard(card.id, { zone: "outside" });
  appendHand(game, playerId, ...cards);
}
function attach(game, playerId, card, sourcePlayerId = null) {
  game.registerCard(card, { zone: "deck" });
  game.attachCard(card.id, playerId, { effectId: card.name, sourcePlayerId });
}

test("默认六人红蓝蓝红红蓝，玩家红一，开局牌实例守恒", () => {
  const game = new Game({ heroRules: false, seed: 20260905 }).setup();
  assert.deepEqual(game.players.map(player => player.team), ["red", "blue", "blue", "red", "red", "blue"]);
  assert.deepEqual(game.players.map(player => player.name), ["红一", "蓝一", "蓝二", "红二", "红三", "蓝三"]);
  assert.equal(game.current, 0);
  assert.equal(game.deck.length, 126);
  assert.ok(game.players.every(player => player.hand.length === 4));
  assert.equal(new Set([...game.deck, ...game.players.flatMap(player => player.hand)].map(item => item.id)).size, 150);
  assert.throws(() => new Game({ heroRules: false, names: ["红一", "蓝一"] }), RuleError);
});

test("战绩区总上限5个，批量增加和已满时不溢出，移除后可补充", () => {
  const game = new Game({ heroRules: false, shuffleDeck: false });
  game.addStones("red", "gem", 4);
  assert.equal(game.addStones("red", "crystal", 3), 1);
  assert.deepEqual(game.stoneCounts("red"), { gem: 4, crystal: 1, total: 5 });
  assert.equal(game.addStones("red", "gem"), 0);
  game.removeStones("red", { gem: 2 });
  game.addStones("red", "crystal", 10);
  assert.deepEqual(game.stoneCounts("red"), { gem: 2, crystal: 3, total: 5 });
  assert.equal(game.stoneCounts("blue").total, 0);
});

test("购买接近或达到战绩上限仍摸牌，只获得容得下的星石", () => {
  for (const initial of [4, 5]) {
    const game = new Game({ heroRules: false, shuffleDeck: false });
    setHand(game, 0, []);
    game.addStones("red", "crystal", initial);
    game.purchase(0);
    assert.equal(game.players[0].hand.length, 3);
    assert.deepEqual(game.stoneCounts("red"), { gem: 5 - initial, crystal: initial, total: 5 });
    assert.match(game.log.at(-1), /上限5个/);
  }
});

test("整理手牌先攻击后法术，每类内同系聚集且牌实例不丢失", () => {
  const deck = createDeck();
  const sorted = [...deck].reverse().sort(compareHandCards);
  const firstMagic = sorted.findIndex(item => !ATTACKS.has(item.name));
  assert.ok(sorted.slice(0, firstMagic).every(item => ATTACKS.has(item.name)));
  assert.ok(sorted.slice(firstMagic).every(item => !ATTACKS.has(item.name)));
  for (const group of [sorted.slice(0, firstMagic), sorted.slice(firstMagic)]) {
    for (let index = 1; index < group.length; index++) {
      assert.ok(group[index - 1].element.localeCompare(group[index].element) <= 0);
    }
  }
  assert.deepEqual(sorted.map(item => item.id).sort(), deck.map(item => item.id).sort());
});

test("固定牌堆有150张且保留系别和fate", () => {
  const deck = createDeck();
  assert.equal(deck.length, 150);
  assert.ok(deck.every(c => c.id && c.element && c.fate));
  assert.deepEqual(Object.fromEntries([...new Set(deck.map(c => c.name))].map(n => [n, deck.filter(c => c.name === n).length])), {
    darkStrike: 6, waterStrike: 21, fireStrike: 21, windStrike: 21, thunderStrike: 21,
    earthStrike: 21, holyLight: 11, weakness: 6, poison: 6, holyShield: 10, magicBullet: 6,
  });
});

test("同系或暗灭可以应战，暗灭不能被应战", () => {
  const game = new Game({ heroRules: false, shuffleDeck: false });
  assert.equal(game.canRespond(card("waterStrike", "water"), card("darkStrike", "dark")), true);
  assert.equal(game.canRespond(card("waterStrike", "water"), card("waterStrike", "water")), true);
  assert.equal(game.canRespond(card("waterStrike", "water"), card("fireStrike", "fire")), false);
  assert.equal(game.canRespond(card("darkStrike", "dark"), card("darkStrike", "dark")), false);
  assert.equal(game.canRespond(card("darkStrike", "dark"), card("holyLight", "light")), true);
  assert.equal(game.canRespond(card("darkStrike", "dark"), card("waterStrike", "water")), false);
});

test("攻击造成摸牌并因爆牌降低士气", () => {
  const game = new Game({ heroRules: false, shuffleDeck: false });
  setHand(game, 0, [card("waterStrike", "water")]);
  setHand(game, 1, Array.from({ length: 6 }, (_, i) => card("holyLight", "light", "J", `h${i}`)));
  game.play(0, 0, 1);
  assert.equal(game.players[1].hand.length, 6);
  assert.equal(game.teams.blue.morale, 13);
});

test("虚弱可选择跳过行动或摸三张牌", () => {
  const game = new Game({ heroRules: false, shuffleDeck: false });
  attach(game, 1, card("weakness"));
  assert.equal(game.startTurn(1, { weakness: "skip" }).skipped, true);
  assert.match(game.log.join(" "), /触发【虚弱】/);
  assert.match(game.log.join(" "), /因【虚弱】跳过本回合行动/);
  game.endTurn();
  game.log.length = 0;
  attach(game, 1, card("weakness"));
  assert.equal(game.startTurn(1, { weakness: "draw" }).skipped, false);
  assert.equal(game.players[1].hand.length, 3);
  assert.match(game.log.join(" "), /摸3张牌取消【虚弱】/);
  assert.match(game.log.join(" "), /本回合继续行动/);
});

test("中毒在行动前逐张造成1点法术伤害", () => {
  const game = new Game({ heroRules: false, shuffleDeck: false });
  attach(game, 1, card("holyShield"));
  attach(game, 1, card("poison"), 0); attach(game, 1, card("poison"), 2);
  game.startTurn(1);
  assert.equal(game.players[1].hand.length, 2);
  assert.equal(game.players[1].getStatus("poison").length, 0);
  assert.ok(game.players[1].getStatus("holyShield")[0], "圣盾不能抵消中毒等普通法术伤害");
});

test("应战攻击可以形成连续应战链", () => {
  const game = new Game({ heroRules: false, shuffleDeck: false });
  setHand(game, 0, [card("waterStrike", "water")]);
  setHand(game, 1, [card("waterStrike", "water")]);
  setHand(game, 3, [card("darkStrike", "dark")]);
  game.play(0, 0, 1, { responses: { 1: { index: 0, targetId: 3 }, 3: { index: 0, targetId: 2 } } });
  assert.equal(game.players[2].hand.length, 2);
  assert.match(game.log.join(" "), /【暗灭】命中/);
});

test("异步应战链会对每一次应战攻击重新询问目标", async () => {
  const game = new Game({ heroRules: false, shuffleDeck: false });
  for (let id = 0; id < game.players.length; id++) setHand(game, id, [
    card("waterStrike", "water", "J", `chain${id}a`),
    card("waterStrike", "water", "J", `chain${id}b`),
  ]);
  appendHand(game, 0, card("holyLight", "light", "J", "final-light"));
  const asked = [];
  await game.attackWithDecisions(1, 0, 0, {
    chooseResponse: async ({ target, valid, counterTargets }) => {
      asked.push(target.id);
      const picked = valid[0];
      if (!picked) return null;
      if (picked.card.name === "holyLight") return { index: picked.index };
      return { index: picked.index, targetId: counterTargets[0].id };
    },
  });
  assert.ok(asked.length >= 4);
  assert.equal(asked.filter(id => id === 0).length, 2, "应战链回到同一玩家时必须再次询问");
  assert.ok((game.log.join(" ").match(/使用应战攻击/g) ?? []).length >= 4);
});

test("六人魔弹跳过已参与者，刷新后红二再传给蓝三", async () => {
  for (const asynchronous of [false, true]) {
    const game = new Game({ heroRules: false, shuffleDeck: false });
    for (let id = 0; id < game.players.length; id++) {
      setHand(game, id, [card("magicBullet", "water", "H", `magic${id}`)]);
    }
    appendHand(game, 3, card("magicBullet", "fire", "Y", "magic3b"));
    assert.deepEqual(game.legalTargets(0, game.players[0].hand[0]), [1]);
    const targets = [];
    const next = [];
    if (asynchronous) {
      await game.playMagicWithDecisions(0, 0, { chooseResponse: context => {
        targets.push(context.target.id); next.push(context.nextTarget.id);
        return context.valid[0];
      } });
      assert.deepEqual(targets, [1, 3, 5, 4, 2, 3, 5]);
      assert.deepEqual(next, [3, 5, 4, 2, 3, 5, 0]);
    } else {
      // This tests relay rules, so explicitly request every legal relay rather
      // than depending on whichever production AI is currently promoted.
      game.automaticDecision = r => r.type === "response" ? r.valid[0] : legacy.chooseAiRuleDecision(r, game);
      game.play(0, 0, 1, { autoRespond: true });
    }
    assert.equal(game.players[5].hand.length, 6);
    assert.equal(game.discard.filter(item => item.id.startsWith("magic")).length, 7);
    assert.match(game.log.join(" "), /刷新魔弹指定记录/);
  }
});

test("魔弹每次真正传到玩家时才请求响应，可多轮选择不同牌，圣光终止", async () => {
  const game = new Game({ heroRules: false, shuffleDeck: false });
  for (const player of game.players) setHand(game, player.id, [card("magicBullet")]);
  appendHand(game, 3, card("magicBullet"), card("holyLight", "light"));
  const visits = [];
  await game.playMagicWithDecisions(0, 0, { chooseResponse: ({ target, valid }) => {
    visits.push(target.id);
    return target.id === 3 && visits.filter(id => id === 3).length === 2 ? valid.find(item => item.card.name === "holyLight") : valid[0];
  } });
  assert.deepEqual(visits, [1, 3, 5, 4, 2, 3]);
  assert.equal(game.players[3].hand.length, 1);
  assert.equal(game.players[3].hand[0].name, "magicBullet");
  assert.match(game.log.at(-1), /抵消/);
  assert.match(game.log.join(" "), /伤害增至3/);
});

test("购买和合成都要求至多3张手牌并摸3张", () => {
  const game = new Game({ heroRules: false, shuffleDeck: false });
  setHand(game, 0, [card("holyLight", "light")]);
  game.purchase(0);
  assert.equal(game.players[0].hand.length, 4);
  assert.deepEqual(game.stoneCounts("red"), { gem: 1, crystal: 1, total: 2 });
  assert.throws(() => game.synthesize(0), RuleError);
  for (const card of game.players[0].hand.slice(2)) game.moveCard(card.id, { zone: "discard" });
  game.addStones("red", "gem", 2);
  game.synthesize(0, 2);
  assert.equal(game.players[0].hand.length, 5);
  assert.equal(game.teams.red.cups, 1);
  assert.equal(game.teams.blue.morale, 14);
});

test("主动攻击命中获得宝石，应战攻击命中获得水晶", () => {
  const active = new Game({ heroRules: false, shuffleDeck: false });
  setHand(active, 0, [card("darkStrike", "dark")]);
  active.play(0, 0, 1);
  assert.deepEqual(active.stoneCounts("red"), { gem: 1, crystal: 0, total: 1 });

  const counter = new Game({ heroRules: false, shuffleDeck: false });
  setHand(counter, 0, [card("waterStrike", "water")]);
  setHand(counter, 1, [card("waterStrike", "water")]);
  counter.play(0, 0, 1, { responseIndex: 0, responseTargetId: 3 });
  assert.deepEqual(counter.stoneCounts("blue"), { gem: 0, crystal: 1, total: 1 });
});

test("圣盾抵消后攻击不算命中且不产生星石", () => {
  const game = new Game({ heroRules: false, shuffleDeck: false });
  setHand(game, 0, [card("darkStrike", "dark")]);
  attach(game, 1, card("holyShield"));
  game.play(0, 0, 1);
  assert.equal(game.stoneCounts("red").total, 0);
  assert.deepEqual(game.players[1].getStatus("holyShield"), []);
  assert.equal(game.players[1].hand.length, 0);
});

test("战绩已满时主动和异步应战命中仍造成伤害，但不再增加星石", async () => {
  const active = new Game({ heroRules: false, shuffleDeck: false });
  active.addStones("red", "crystal", 5);
  setHand(active, 0, [card("darkStrike", "dark")]);
  setHand(active, 1, []);
  active.play(0, 0, 1);
  assert.equal(active.players[1].hand.length, 2);
  assert.deepEqual(active.stoneCounts("red"), { gem: 0, crystal: 5, total: 5 });
  assert.match(active.log.at(-1), /未增加星石/);

  const counter = new Game({ heroRules: false, shuffleDeck: false });
  counter.addStones("blue", "gem", 5);
  setHand(counter, 0, [card("waterStrike", "water")]);
  setHand(counter, 1, [card("waterStrike", "water")]);
  setHand(counter, 3, []);
  await counter.attackWithDecisions(0, 0, 1, {
    chooseResponse: ({ target }) => target.id === 1 ? { index: 0, targetId: 3 } : null,
  });
  assert.equal(counter.players[3].hand.length, 2);
  assert.deepEqual(counter.stoneCounts("blue"), { gem: 5, crystal: 0, total: 5 });
  assert.match(counter.log.at(-1), /未增加星石/);
});

test("提炼1至2个星石进入个人能量且不改变手牌", () => {
  const game = new Game({ heroRules: false, shuffleDeck: false });
  game.addStones("red", "gem", 2);
  game.addStones("red", "crystal", 1);
  setHand(game, 0, [card("darkStrike")]);
  game.refine(0, { gem: 1, crystal: 1 });
  assert.equal(game.players[0].hand.length, 1);
  assert.deepEqual(game.players[0].energy, { gem: 1, crystal: 1 });
  assert.deepEqual(game.stoneCounts("red"), { gem: 1, crystal: 0, total: 1 });
  assert.throws(() => game.refine(0, { gem: 2, crystal: 1 }), RuleError);
});

test("合成第五个星杯强制获胜", () => {
  const game = new Game({ heroRules: false, shuffleDeck: false });
  game.teams.red.cups = 4;
  game.addStones("red", "gem", 3);
  setHand(game, 0, []);
  game.synthesize(0, 3);
  assert.equal(game.teams.red.cups, 5);
  assert.equal(game.winner, "red");
});

test("合成选择：同类星石或总数恰好3时自动，混合且超过3时询问合法组合", () => {
  const onlyGems = new Game({ heroRules: false, shuffleDeck: false });
  onlyGems.addStones("red", "gem", 5);
  assert.deepEqual(onlyGems.synthesisOptions("red"), { automatic: true, gemCount: 3, choices: [3] });

  const exactlyThree = new Game({ heroRules: false, shuffleDeck: false });
  exactlyThree.addStones("red", "gem", 1);
  exactlyThree.addStones("red", "crystal", 2);
  assert.deepEqual(exactlyThree.synthesisOptions("red"), { automatic: true, gemCount: 1, choices: [1] });

  const mixed = new Game({ heroRules: false, shuffleDeck: false });
  mixed.addStones("red", "gem", 2);
  mixed.addStones("red", "crystal", 3);
  assert.deepEqual(mixed.synthesisOptions("red"), { automatic: false, choices: [0, 1, 2] });
});

test("AI合成永远选择合法组合中最少的宝石，即尽量使用水晶", () => {
  const game = new Game({ heroRules: false, shuffleDeck: false });
  game.addStones("red", "gem", 3);
  game.addStones("red", "crystal", 2);
  setHand(game, 0, []);
  const action = chooseAiAction(game, 0);
  assert.equal(action.type, "synthesize");
  assert.equal(action.gemCount, 1);
});

test("玩家爆牌可延迟选择，必须选择不同合法编号并按弃牌数降低士气", () => {
  const game = new Game({ heroRules: false, shuffleDeck: false });
  setHand(game, 0, Array.from({ length: 6 }, (_, index) => card("holyLight", "light", "J", `h${index}`)));
  game.draw(0, 2, { overflow: "defer" });
  assert.equal(game.players[0].hand.length, 8);
  assert.equal(game.teams.red.morale, 15);
  assert.throws(() => game.resolveOverflow(0, [0, 0]), RuleError);
  const discarded = game.resolveOverflow(0, [0, 7]);
  assert.equal(discarded.length, 2);
  assert.equal(game.players[0].hand.length, 6);
  assert.equal(game.teams.red.morale, 13);
  assert.match(game.log.join(" "), /爆牌，暗弃2张手牌；己方士气-2/);
});

test("显式random爆牌策略兼容随机弃置并立即降低士气", () => {
  const game = new Game({ heroRules: false, shuffleDeck: false, seed: 8 });
  setHand(game, 1, Array.from({ length: 6 }, (_, index) => card("holyLight", "light", "J", `a${index}`)));
  game.draw(1, 2, { overflow: "random" });
  assert.equal(game.players[1].hand.length, 6);
  assert.equal(game.teams.blue.morale, 13);
});

test("无法行动要求全部手牌不可用、空余位不超过2且英雄无法通过技能行动", () => {
  const game = new Game({ heroRules: false, shuffleDeck: false });
  for (const player of game.players) {
    attach(game, player.id, card("holyShield"));
    attach(game, player.id, card("weakness"));
  }
  setHand(game, 0, [card("holyLight", "light"), card("holyShield"), card("weakness"), card("holyLight", "light")]);
  assert.equal(game.unusableCards(0).length, 4);
  assert.equal(game.canRefreshUnableHand(0), true);
  assert.equal(chooseAiAction(game, 0).type, "refresh");
  appendHand(game, 0, card("waterStrike"));
  assert.equal(game.unusableCards(0).length, 4);
  assert.equal(game.canRefreshUnableHand(0), false);
  assert.notEqual(chooseAiAction(game, 0).type, "refresh");
  assert.throws(() => game.refreshUnableHand(0), RuleError);
  game.discardCard(game.player(0), 4);
  game.player(0).hero.canActWithSkills = true;
  assert.equal(game.canRefreshUnableHand(0), false);
  assert.throws(() => game.refreshUnableHand(0), RuleError);
  game.player(0).hero.canActWithSkills = false;
  game.player(0).handLimit = 7;
  assert.equal(game.canRefreshUnableHand(0), false);
  assert.throws(() => game.refreshUnableHand(0), RuleError);
  game.player(0).handLimit = 6;
  assert.throws(() => game.play(0, 0, 1), RuleError);
  game.refreshUnableHand(0);
  assert.equal(game.players[0].hand.length, 4);
  assert.equal(game.teams.red.morale, 15);
  setHand(game, 0, [card("holyLight", "light"), card("holyLight", "light"), card("holyLight", "light")]);
  assert.equal(game.canRefreshUnableHand(0), false);
  assert.throws(() => game.refreshUnableHand(0), RuleError);
});

test("冻结v1.2优先给己方圣盾，并向手牌最多的敌人使用中毒或虚弱", () => {
  const game = new Game({ heroRules: false, shuffleDeck: false, seed: 1 });
  setHand(game, 0, [card("holyShield")]);
  assert.ok([0, 3, 4].includes(chooseAiAction(game, 0).targetId));
  setHand(game, 0, [card("poison")]);
  setHand(game, 1, [card("darkStrike")]);
  setHand(game, 2, [card("darkStrike"), card("darkStrike")]);
  assert.equal(rankAiActions(game, 0).find(entry => entry.action.type === "play").action.targetId, 2);
});
