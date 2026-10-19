import test from "node:test";
import assert from "node:assert/strict";
import { Game } from "../src/engine.js";
import { logCard } from "../src/action-log.js";
const take = (game, id, predicate) => game.moveCard(game.deck.find(predicate).id, { zone: "hand", playerId: id });

test("水之神力记录目标/费用/交牌/实际治疗；普通局不泄露交牌，测试局显示属性命格", async () => {
  for (const revealHiddenLogs of [false, true]) {
    const game = new Game({ seed: 13, heroIds: ["priest", "windSwordmaster", "berserker", "marksman", "guardianAngel", "sealer"], revealHiddenLogs });
    const cost = take(game, 0, card => card.element === "water");
    const gift = take(game, 0, card => card.element === "wind" && card.fate === "J");
    game.player(3).healing = 2; game.log = [];
    await game.executeAction(0, { type: "skill", skillId: "waterPower", cardIds: [cost.id], targetIds: [3] }, { choose: request => request.type === "cardChoice" ? [0] : request.defaultValue });
    const logs = game.log.join("\n");
    assert.match(logs, /神官（红一）发动【水之神力】：目标：神箭手（红二）/);
    assert.match(logs, /明弃1张手牌/);
    const transfer = game.log.find(line => line.includes("交给了"));
    assert.equal(transfer.includes("[风][技]攻击"), revealHiddenLogs);
    assert.match(transfer, /神官（红一）将一张牌.*交给了神箭手（红二）/);
    assert.match(logs, /治疗\+0（2→2；上限2，未增加1）/);
    assert.equal(gift.location.playerId, 3); game.assertCardLocations();
  }
});

test("隐藏弃牌记录统一覆盖技能/爆牌/盖牌，普通与测试记录不会改变结算", () => {
  const results = [];
  for (const revealHiddenLogs of [false, true]) {
    const game = new Game({ seed: 13, revealHiddenLogs });
    for (let n = 0; n < 8; n++) take(game, 0, card => card.name === "fireStrike");
    const detail = logCard(game.player(0).hand[0], game, 0);
    game.log = [];
    game.draw(0, 0, { overflow: "defer" }); game.resolveOverflow(0, [0, 1]);
    assert.equal(game.log.at(-1).includes(detail), revealHiddenLogs);
    game.discardCards(0, [game.player(0).hand[0]], { visibility: "hidden", reason: "sacredDomain" });
    assert.equal(game.log.at(-1).includes("[火]"), revealHiddenLogs);
    game.discardCards(0, [game.player(0).hand[0]], { visibility: "public", covered: true });
    assert.equal(game.log.at(-1).includes("[火]"), revealHiddenLogs);
    game.discardCards(0, [game.player(0).hand[0]], { visibility: "public" });
    assert.match(game.log.at(-1), /明弃1张手牌（\[火\]/);
    results.push({ hand: game.player(0).hand.map(card => card.id), discard: game.discard.map(card => [card.id, card.discardVisibility]), morale: game.teams.red.morale });
  }
  assert.deepEqual(results[0], results[1]);
});

test("被动增伤、额外行动、费用、效果挂载及移除保留具体结果", () => {
  const game = new Game({ seed: 13 });
  const attack = take(game, 0, card => card.hasUniqueSkill("bloodBlade"));
  take(game, 1, card => card.name === "poison"); take(game, 1, card => card.name === "weakness");
  game.player(0).energy.gem = 1; game.log = [];
  game.attack(0, game.player(0).hand.indexOf(attack), 1, { skillChoices: { bloodBlade: true, rend: true } });
  const logs = game.log.join("\n");
  assert.match(logs, /狂化.*伤害\+1/);
  assert.match(logs, /血影狂刀.*目标手牌2张，伤害\+2/);
  assert.match(logs, /消耗1宝石、0水晶；剩余0宝石、0水晶/);
  assert.match(logs, /撕裂.*伤害\+2，变为7/);
  game.startTurn(1); game.turn.addAttackAction({ element: "wind", sourceSkillId: "windFury" });
  assert.match(game.log.at(-1), /风怒追击.*风系限定额外攻击行动/);
  const effect = game.deck.find(card => card.hasUniqueSkill("angelWall"));
  game.attachCard(effect.id, 3, { effectId: "holyShield", sourcePlayerId: 4, sourceSkillId: "angelWall" });
  assert.match(game.log.at(-1), /圣盾.*附加到封印师.*基础效果/);
  game.removeEffect(effect.id, { zone: "hand", playerId: 0 });
  assert.match(game.log.at(-1), /圣盾.*被移除，收入狂战士.*手牌/);
});
