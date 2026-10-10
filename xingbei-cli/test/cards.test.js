import test from "node:test";
import assert from "node:assert/strict";
import { createDeck, compareHandCards, ATTACKS } from "../src/cards.js";
import { Game, RuleError } from "../src/engine.js";
import { chooseAiAction } from "../src/ai.js";

const card = (name, element = "shui", fate = "ji", id = Math.random().toString()) => ({ id, name, element, fate });

test("战绩区总上限5个，批量增加和已满时不溢出，移除后可补充", () => {
  const game = new Game({ shuffleDeck: false });
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
    const game = new Game({ shuffleDeck: false });
    game.players[0].hand = [];
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
    anMie: 6, shuiLianZhan: 21, huoYanZhan: 21, fengShenZhan: 21, leiGuangZhan: 21,
    diLieZhan: 21, shengGuang: 11, xuRuo: 6, zhongDu: 6, shengDun: 10, moDan: 6,
  });
});

test("同系或暗灭可以应战，暗灭不能被应战", () => {
  const game = new Game({ shuffleDeck: false });
  assert.equal(game.canRespond(card("shuiLianZhan", "shui"), card("anMie", "an")), true);
  assert.equal(game.canRespond(card("shuiLianZhan", "shui"), card("shuiLianZhan", "shui")), true);
  assert.equal(game.canRespond(card("shuiLianZhan", "shui"), card("huoYanZhan", "huo")), false);
  assert.equal(game.canRespond(card("anMie", "an"), card("anMie", "an")), false);
  assert.equal(game.canRespond(card("anMie", "an"), card("shengGuang", "guang")), true);
  assert.equal(game.canRespond(card("anMie", "an"), card("shuiLianZhan", "shui")), false);
});

test("攻击造成摸牌并因爆牌降低士气", () => {
  const game = new Game({ shuffleDeck: false });
  game.players[0].hand = [card("shuiLianZhan", "shui")];
  game.players[1].hand = Array.from({ length: 6 }, (_, i) => card("shengGuang", "guang", "ji", `h${i}`));
  game.play(0, 0, 1);
  assert.equal(game.players[1].hand.length, 6);
  assert.equal(game.teams.blue.morale, 13);
});

test("圣盾强制抵消一次攻击后弃置", () => {
  const game = new Game({ shuffleDeck: false });
  game.players[0].hand = [card("shuiLianZhan")];
  game.players[1].shield = card("shengDun");
  game.play(0, 0, 1);
  assert.equal(game.players[1].shield, null);
  assert.equal(game.players[1].hand.length, 0);
});

test("虚弱可选择跳过行动或摸三张牌", () => {
  const game = new Game({ shuffleDeck: false });
  game.players[1].weakness = card("xuRuo");
  assert.equal(game.startTurn(1, { weakness: "skip" }).skipped, true);
  assert.match(game.log.join(" "), /触发【虚弱】/);
  assert.match(game.log.join(" "), /因【虚弱】跳过本回合行动/);
  game.log.length = 0;
  game.players[1].weakness = card("xuRuo");
  assert.equal(game.startTurn(1, { weakness: "draw" }).skipped, false);
  assert.equal(game.players[1].hand.length, 3);
  assert.match(game.log.join(" "), /摸3张牌取消【虚弱】/);
  assert.match(game.log.join(" "), /本回合继续行动/);
});

test("中毒在行动前逐张造成1点法术伤害", () => {
  const game = new Game({ shuffleDeck: false });
  game.players[1].shield = card("shengDun");
  game.players[1].poisons = [{ card: card("zhongDu"), sourceId: 0 }, { card: card("zhongDu"), sourceId: 2 }];
  game.startTurn(1);
  assert.equal(game.players[1].hand.length, 2);
  assert.equal(game.players[1].poisons.length, 0);
  assert.ok(game.players[1].shield, "圣盾不能抵消中毒等普通法术伤害");
});

test("魔弹可传递并增加伤害，圣光可终止", () => {
  const game = new Game({ shuffleDeck: false });
  game.players[0].hand = [card("moDan")];
  game.players[1].hand = [card("moDan")];
  game.players[2].hand = [card("shengGuang", "guang")];
  game.play(0, 0, 1, { responses: { 1: 0, 2: 0 } });
  assert.equal(game.players[2].hand.length, 0);
  assert.match(game.log.join(" "), /伤害增至3/);
  assert.match(game.log.join(" "), /【圣光】抵消【魔弹】/);
});

test("应战攻击可以形成连续应战链", () => {
  const game = new Game({ shuffleDeck: false });
  game.players[0].hand = [card("shuiLianZhan", "shui")];
  game.players[1].hand = [card("shuiLianZhan", "shui")];
  game.players[2].hand = [card("anMie", "an")];
  game.play(0, 0, 1, { responses: { 1: { index: 0, targetId: 2 }, 2: { index: 0, targetId: 3 } } });
  assert.equal(game.players[3].hand.length, 2);
  assert.match(game.log.join(" "), /【暗灭】命中/);
});

test("同一玩家可以重复参与应战链", () => {
  const game = new Game({ shuffleDeck: false });
  game.players[0].hand = [card("shuiLianZhan", "shui"), card("shuiLianZhan", "shui")];
  game.players[1].hand = [card("shuiLianZhan", "shui")];
  game.players[2].hand = [card("shuiLianZhan", "shui")];
  game.players[3].hand = [card("shuiLianZhan", "shui")];
  game.play(0, 0, 1, { autoRespond: true });
  assert.equal(game.players[0].hand.length, 0, "0号玩家应在同一应战链中再次出牌");
  assert.match(game.log.join(" "), /红一使用应战攻击/);
});

test("异步应战链会对每一次应战攻击重新询问目标", async () => {
  const game = new Game({ shuffleDeck: false });
  for (let id = 0; id < 4; id++) game.players[id].hand = [
    card("shuiLianZhan", "shui", "ji", `chain${id}a`),
    card("shuiLianZhan", "shui", "ji", `chain${id}b`),
  ];
  game.players[0].hand.push(card("shengGuang", "guang", "ji", "final-light"));
  const asked = [];
  await game.attackWithDecisions(1, 0, 0, {
    chooseResponse: async ({ target, valid, counterTargets }) => {
      asked.push(target.id);
      const picked = valid[0];
      if (picked.card.name === "shengGuang") return { index: picked.index };
      return { index: picked.index, targetId: counterTargets[0].id };
    },
  });
  assert.ok(asked.length >= 4);
  assert.equal(asked.filter(id => id === 0).length, 2, "应战链回到同一玩家时必须再次询问");
  assert.ok((game.log.join(" ").match(/使用应战攻击/g) ?? []).length >= 4);
});

test("魔弹指定所有人后刷新记录并可重复指定", () => {
  const game = new Game({ shuffleDeck: false });
  for (let id = 0; id < 4; id++) game.players[id].hand = [card("moDan", "shui", "huan", `m${id}`)];
  game.players[0].hand.push(card("moDan", "shui", "huan", "m0b"));
  game.play(0, 0, null, { autoRespond: true });
  assert.match(game.log.join(" "), /刷新魔弹指定记录/);
  assert.match(game.log.join(" "), /红一用【魔弹】传递【魔弹】/);
});

test("AI有合法牌时必定应战，日志区分主动和应战攻击", () => {
  const game = new Game({ shuffleDeck: false, seed: 3 });
  game.players[0].hand = [card("shuiLianZhan", "shui")];
  game.players[1].hand = [card("shuiLianZhan", "shui")];
  game.play(0, 0, 1, { autoRespond: true });
  const log = game.log.join(" ");
  assert.match(log, /使用主动攻击【水涟斩】/);
  assert.match(log, /使用应战攻击【水涟斩】/);
});

test("不能主动使用圣光", () => {
  const game = new Game({ shuffleDeck: false });
  game.players[0].hand = [card("shengGuang", "guang")];
  assert.throws(() => game.play(0, 0, 1), RuleError);
});

test("购买和合成都要求至多3张手牌并摸3张", () => {
  const game = new Game({ shuffleDeck: false });
  game.players[0].hand = [card("shengGuang", "guang")];
  game.purchase(0);
  assert.equal(game.players[0].hand.length, 4);
  assert.deepEqual(game.stoneCounts("red"), { gem: 1, crystal: 1, total: 2 });
  assert.throws(() => game.synthesize(0), RuleError);
  game.players[0].hand.length = 2;
  game.addStones("red", "gem", 2);
  game.synthesize(0, 2);
  assert.equal(game.players[0].hand.length, 5);
  assert.equal(game.teams.red.cups, 1);
  assert.equal(game.teams.blue.morale, 14);
});

test("主动攻击命中获得宝石，应战攻击命中获得水晶", () => {
  const active = new Game({ shuffleDeck: false });
  active.players[0].hand = [card("anMie", "an")];
  active.play(0, 0, 1);
  assert.deepEqual(active.stoneCounts("red"), { gem: 1, crystal: 0, total: 1 });

  const counter = new Game({ shuffleDeck: false });
  counter.players[0].hand = [card("shuiLianZhan", "shui")];
  counter.players[1].hand = [card("shuiLianZhan", "shui")];
  counter.play(0, 0, 1, { responseIndex: 0, responseTargetId: 2 });
  assert.deepEqual(counter.stoneCounts("blue"), { gem: 0, crystal: 1, total: 1 });
});

test("圣盾抵消后攻击不算命中且不产生星石", () => {
  const game = new Game({ shuffleDeck: false });
  game.players[0].hand = [card("anMie", "an")];
  game.players[1].shield = card("shengDun");
  game.play(0, 0, 1);
  assert.equal(game.stoneCounts("red").total, 0);
});

test("战绩已满时主动和异步应战命中仍造成伤害，但不再增加星石", async () => {
  const active = new Game({ shuffleDeck: false });
  active.addStones("red", "crystal", 5);
  active.players[0].hand = [card("anMie", "an")];
  active.players[1].hand = [];
  active.play(0, 0, 1);
  assert.equal(active.players[1].hand.length, 2);
  assert.deepEqual(active.stoneCounts("red"), { gem: 0, crystal: 5, total: 5 });
  assert.match(active.log.at(-1), /未增加星石/);

  const counter = new Game({ shuffleDeck: false });
  counter.addStones("blue", "gem", 5);
  counter.players[0].hand = [card("shuiLianZhan", "shui")];
  counter.players[1].hand = [card("shuiLianZhan", "shui")];
  counter.players[2].hand = [];
  await counter.attackWithDecisions(0, 0, 1, {
    chooseResponse: ({ target }) => target.id === 1 ? { index: 0, targetId: 2 } : null,
  });
  assert.equal(counter.players[2].hand.length, 2);
  assert.deepEqual(counter.stoneCounts("blue"), { gem: 5, crystal: 0, total: 5 });
  assert.match(counter.log.at(-1), /未增加星石/);
});

test("提炼1至2个星石进入个人能量且不改变手牌", () => {
  const game = new Game({ shuffleDeck: false });
  game.addStones("red", "gem", 2);
  game.addStones("red", "crystal", 1);
  game.players[0].hand = [card("anMie")];
  game.refine(0, { gem: 1, crystal: 1 });
  assert.equal(game.players[0].hand.length, 1);
  assert.deepEqual(game.players[0].energy, { gem: 1, crystal: 1 });
  assert.deepEqual(game.stoneCounts("red"), { gem: 1, crystal: 0, total: 1 });
  assert.throws(() => game.refine(0, { gem: 2, crystal: 1 }), RuleError);
});

test("合成第五个星杯强制获胜", () => {
  const game = new Game({ shuffleDeck: false });
  game.teams.red.cups = 4;
  game.addStones("red", "gem", 3);
  game.players[0].hand = [];
  game.synthesize(0, 3);
  assert.equal(game.teams.red.cups, 5);
  assert.equal(game.winner, "red");
});

test("合成选择：同类星石或总数恰好3时自动，混合且超过3时询问合法组合", () => {
  const onlyGems = new Game({ shuffleDeck: false });
  onlyGems.addStones("red", "gem", 5);
  assert.deepEqual(onlyGems.synthesisOptions("red"), { automatic: true, gemCount: 3, choices: [3] });

  const exactlyThree = new Game({ shuffleDeck: false });
  exactlyThree.addStones("red", "gem", 1);
  exactlyThree.addStones("red", "crystal", 2);
  assert.deepEqual(exactlyThree.synthesisOptions("red"), { automatic: true, gemCount: 1, choices: [1] });

  const mixed = new Game({ shuffleDeck: false });
  mixed.addStones("red", "gem", 2);
  mixed.addStones("red", "crystal", 3);
  assert.deepEqual(mixed.synthesisOptions("red"), { automatic: false, choices: [0, 1, 2] });
});

test("AI合成永远选择合法组合中最少的宝石，即尽量使用水晶", () => {
  const game = new Game({ shuffleDeck: false });
  game.addStones("red", "gem", 3);
  game.addStones("red", "crystal", 2);
  game.players[0].hand = [];
  const action = chooseAiAction(game, 0);
  assert.equal(action.type, "synthesize");
  assert.equal(action.gemCount, 1);
});

test("玩家爆牌可延迟选择，必须选择不同合法编号并按弃牌数降低士气", () => {
  const game = new Game({ shuffleDeck: false });
  game.players[0].hand = Array.from({ length: 6 }, (_, index) => card("shengGuang", "guang", "ji", `h${index}`));
  game.draw(0, 2, { overflow: "defer" });
  assert.equal(game.players[0].hand.length, 8);
  assert.equal(game.teams.red.morale, 15);
  assert.throws(() => game.resolveOverflow(0, [0, 0]), RuleError);
  const discarded = game.resolveOverflow(0, [0, 7]);
  assert.equal(discarded.length, 2);
  assert.equal(game.players[0].hand.length, 6);
  assert.equal(game.teams.red.morale, 13);
  assert.match(game.log.join(" "), /爆牌，弃置【.+】、【.+】；己方士气-2/);
});

test("AI爆牌随机弃置并立即降低士气", () => {
  const game = new Game({ shuffleDeck: false, seed: 8 });
  game.players[1].hand = Array.from({ length: 6 }, (_, index) => card("shengGuang", "guang", "ji", `a${index}`));
  game.draw(1, 2, { overflow: "random" });
  assert.equal(game.players[1].hand.length, 6);
  assert.equal(game.teams.blue.morale, 13);
});

test("圣光和无合法目标的状态牌计为不可用牌", () => {
  const game = new Game({ shuffleDeck: false });
  for (const player of game.players) {
    player.shield = card("shengDun");
    player.weakness = card("xuRuo");
  }
  game.players[0].hand = [card("shengGuang", "guang"), card("shengDun"), card("xuRuo"), card("shengGuang", "guang")];
  assert.equal(game.unusableCards(0).length, 4);
  game.refreshUnableHand(0);
  assert.equal(game.players[0].hand.length, 4);
  assert.equal(game.teams.red.morale, 15);
});

test("AI优先给己方圣盾，并向手牌最多的敌人使用中毒或虚弱", () => {
  const game = new Game({ shuffleDeck: false, seed: 1 });
  game.players[0].hand = [card("shengDun")];
  assert.ok([0, 2].includes(chooseAiAction(game, 0).targetId));
  game.players[0].hand = [card("zhongDu")];
  game.players[1].hand = [card("anMie")];
  game.players[3].hand = [card("anMie"), card("anMie")];
  assert.equal(chooseAiAction(game, 0).targetId, 3);
});
