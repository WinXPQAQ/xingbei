import { ATTACKS, cardName, createDeck } from "./cards.js";

export class RuleError extends Error {}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function shuffle(items, random) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export class Game {
  constructor({ names = ["红一", "蓝一", "红二", "蓝二"], seed = Date.now(), shuffleDeck = true } = {}) {
    if (names.length !== 4) throw new RuleError("第一版仅支持 2v2（4 名玩家）");
    this.random = seededRandom(seed);
    this.players = names.map((name, seat) => ({
      id: seat, name, team: seat % 2 === 0 ? "red" : "blue", hand: [], shield: null,
      weakness: null, poisons: [], healing: 0, energy: { gem: 0, crystal: 0 },
    }));
    this.teams = { red: { morale: 15, achievements: [], cups: 0 }, blue: { morale: 15, achievements: [], cups: 0 } };
    this.deck = createDeck();
    if (shuffleDeck) shuffle(this.deck, this.random);
    this.discard = [];
    this.current = 0;
    this.winner = null;
    this.log = [];
  }

  setup(handSize = 4) {
    for (const player of this.players) this.draw(player.id, handSize, { overflow: "first" });
    return this;
  }

  player(id) {
    const player = this.players[Number(id)];
    if (!player) throw new RuleError(`不存在玩家 ${id}`);
    return player;
  }

  draw(id, count, { overflow = "first", moraleLoss = true } = {}) {
    const player = this.player(id);
    for (let i = 0; i < count; i++) {
      if (!this.deck.length) {
        if (!this.discard.length) break;
        this.deck = shuffle(this.discard.splice(0), this.random);
        this.log.push("弃牌堆洗回牌库");
      }
      player.hand.push(this.deck.pop());
    }
    const excess = Math.max(0, player.hand.length - 6);
    if (excess) {
      const policy = typeof overflow === "function" ? overflow(player, excess) : overflow;
      if (policy === "defer") {
        player.pendingOverflow = { moraleLoss };
      } else {
        let indexes = policy;
        if (policy === "first") indexes = Array.from({ length: excess }, (_, index) => index);
        if (policy === "random") indexes = this.randomIndexes(player.hand.length, excess);
        this.resolveOverflow(id, indexes, { moraleLoss });
      }
    }
  }

  randomIndexes(length, count) {
    const available = Array.from({ length }, (_, index) => index);
    const selected = [];
    while (selected.length < count) selected.push(available.splice(Math.floor(this.random() * available.length), 1)[0]);
    return selected;
  }

  resolveOverflow(id, indexes, { moraleLoss = true } = {}) {
    const player = this.player(id);
    const excess = Math.max(0, player.hand.length - 6);
    if (!excess) { delete player.pendingOverflow; return []; }
    if (!Array.isArray(indexes) || indexes.length !== excess || new Set(indexes).size !== excess ||
        indexes.some(index => !Number.isInteger(index) || index < 0 || index >= player.hand.length)) {
      throw new RuleError(`爆牌必须选择${excess}张不同的合法手牌`);
    }
    const discarded = [...indexes].sort((a, b) => b - a).map(index => this.discardCard(player, index));
    if (moraleLoss) this.changeMorale(player.team, -excess);
    delete player.pendingOverflow;
    this.log.push(`${player.name}爆牌，弃置${discarded.map(cardName).join("、")}；己方士气-${moraleLoss ? excess : 0}`);
    return discarded;
  }

  discardCard(player, index) {
    if (!Number.isInteger(index) || index < 0 || index >= player.hand.length) throw new RuleError("无效的手牌编号");
    const [card] = player.hand.splice(index, 1);
    this.discard.push(card);
    return card;
  }

  changeMorale(team, amount) {
    this.teams[team].morale = Math.min(15, this.teams[team].morale + amount);
    this.checkWinner();
  }

  checkWinner() {
    if (this.teams.red.morale <= 0 || this.teams.blue.cups >= 5) this.winner = "blue";
    if (this.teams.blue.morale <= 0 || this.teams.red.cups >= 5) this.winner = "red";
    return this.winner;
  }

  legalTargets(actorId, card) {
    const actor = this.player(actorId);
    if (card.name === "shengGuang") return [];
    if (card.name === "moDan") return this.nearestOpponent(actorId) ? [null] : [];
    if (ATTACKS.has(card.name)) return this.players.filter(p => p.team !== actor.team).map(p => p.id);
    if (card.name === "shengDun") return this.players.filter(p => !p.shield).map(p => p.id);
    if (card.name === "xuRuo") return this.players.filter(p => !p.weakness).map(p => p.id);
    if (card.name === "zhongDu") return this.players.map(p => p.id);
    return [];
  }

  legalCards(actorId) {
    return this.player(actorId).hand
      .map((card, index) => ({ card, index, targets: this.legalTargets(actorId, card) }))
      .filter(action => action.targets.length);
  }

  unusableCards(actorId) {
    return this.player(actorId).hand.filter(card => !this.legalTargets(actorId, card).length);
  }

  canDrawSpecial(actorId) {
    return this.player(actorId).hand.length <= 3;
  }

  stoneCounts(team) {
    const stones = this.teams[team].achievements;
    return {
      gem: stones.filter(stone => stone === "gem").length,
      crystal: stones.filter(stone => stone === "crystal").length,
      total: stones.length,
    };
  }

  synthesisOptions(team) {
    const stones = this.stoneCounts(team);
    if (stones.total < 3) return { automatic: false, choices: [] };
    const choices = [0, 1, 2, 3].filter(gem => gem <= stones.gem && 3 - gem <= stones.crystal);
    if (choices.length === 1) return { automatic: true, gemCount: choices[0], choices };
    return { automatic: false, choices };
  }

  addStones(team, type, count = 1) {
    const stones = this.teams[team].achievements;
    const added = Math.max(0, Math.min(count, 5 - stones.length));
    for (let i = 0; i < added; i++) stones.push(type);
    return added;
  }

  removeStones(team, { gem = 0, crystal = 0 }) {
    const counts = this.stoneCounts(team);
    if (gem < 0 || crystal < 0 || gem > counts.gem || crystal > counts.crystal) {
      throw new RuleError("战绩区没有足够的星石");
    }
    for (const [type, count] of [["gem", gem], ["crystal", crystal]]) {
      for (let i = 0; i < count; i++) {
        const index = this.teams[team].achievements.indexOf(type);
        this.teams[team].achievements.splice(index, 1);
      }
    }
  }

  purchase(actorId, options = {}) {
    if (!this.canDrawSpecial(actorId)) throw new RuleError("购买只能在手牌为0至3张时执行");
    this.draw(actorId, 3, options);
    const player = this.player(actorId);
    const gems = this.addStones(player.team, "gem");
    const crystals = this.addStones(player.team, "crystal");
    this.log.push(`${player.name}执行购买，摸3张牌；己方战绩区获得${gems}个宝石和${crystals}个水晶${gems + crystals < 2 ? "（战绩区上限5个）" : ""}`);
  }

  synthesize(actorId, gemCount, options = {}) {
    if (!this.canDrawSpecial(actorId)) throw new RuleError("合成只能在手牌为0至3张时执行");
    const player = this.player(actorId);
    const counts = this.stoneCounts(player.team);
    if (counts.total < 3) throw new RuleError("合成需要3个星石");
    if (!Number.isInteger(gemCount) || gemCount < 0 || gemCount > 3) throw new RuleError("合成的宝石数量必须为0至3");
    const crystalCount = 3 - gemCount;
    this.removeStones(player.team, { gem: gemCount, crystal: crystalCount });
    this.draw(actorId, 3, options);
    this.teams[player.team].cups++;
    const enemyTeam = player.team === "red" ? "blue" : "red";
    this.changeMorale(enemyTeam, -1);
    this.log.push(`${player.name}消耗${gemCount}个宝石、${crystalCount}个水晶执行合成，摸3张牌；己方星杯+1，对方士气-1`);
    this.checkWinner();
  }

  refine(actorId, { gem = 0, crystal = 0 }) {
    const player = this.player(actorId);
    const total = gem + crystal;
    if (!Number.isInteger(gem) || !Number.isInteger(crystal) || total < 1 || total > 2) {
      throw new RuleError("提炼必须选择1至2个星石");
    }
    if (player.energy.gem + player.energy.crystal + total > 3) throw new RuleError("角色能量上限为3");
    this.removeStones(player.team, { gem, crystal });
    player.energy.gem += gem;
    player.energy.crystal += crystal;
    this.log.push(`${player.name}提炼${gem}个宝石、${crystal}个水晶；个人能量变为${player.energy.gem}宝石、${player.energy.crystal}水晶`);
  }

  refreshUnableHand(actorId) {
    const player = this.player(actorId);
    if (this.unusableCards(actorId).length < 4) throw new RuleError("未满足无法行动条件");
    const count = player.hand.length;
    const revealed = player.hand.map(cardName).join("、");
    while (player.hand.length) this.discardCard(player, 0);
    this.draw(actorId, count, { moraleLoss: false });
    this.log.push(`${player.name}无法行动，展示并弃置全部手牌：${revealed}；重摸${count}张`);
  }

  damage(targetId, amount, { sourceId = null, magic = false, overflow = "first", useHealing = 0, shieldable = false } = {}) {
    const target = this.player(targetId);
    if (shieldable && target.shield) {
      this.discard.push(target.shield); target.shield = null;
      this.log.push(`${target.name}的${cardName("shengDun")}抵消了伤害`);
      return 0;
    }
    const healing = Math.min(amount, target.healing, Math.max(0, useHealing));
    target.healing -= healing;
    const actual = amount - healing;
    if (actual) this.draw(targetId, actual, { overflow });
    this.log.push(`${target.name}承受${actual}点${magic ? "法术" : "攻击"}伤害`);
    return actual;
  }

  canRespond(attack, response) {
    if (response.name === "shengGuang") return true;
    // 暗灭只能被圣光响应，不能被暗灭或其他攻击牌应战。
    if (!ATTACKS.has(response.name) || attack.name === "anMie") return false;
    return response.name === "anMie" || response.element === attack.element;
  }

  play(actorId, handIndex, targetId, options = {}) {
    if (this.winner) throw new RuleError("游戏已经结束");
    const actor = this.player(actorId);
    const card = actor.hand[handIndex];
    if (!card) throw new RuleError("无效的手牌编号");
    if (card.name === "shengGuang") throw new RuleError("圣光只能用于响应攻击或魔弹");
    if (ATTACKS.has(card.name)) return this.attack(actorId, handIndex, targetId, options);
    const target = this.player(targetId);
    if (card.name === "shengDun" && target.shield) throw new RuleError("目标已经拥有圣盾");
    if (card.name === "xuRuo" && target.weakness) throw new RuleError("目标已经虚弱");
    this.discardCard(actor, handIndex);
    switch (card.name) {
      case "shengDun":
        target.shield = card; this.discard.pop(); break;
      case "xuRuo":
        target.weakness = card; this.discard.pop(); break;
      case "zhongDu": target.poisons.push({ card, sourceId: actorId }); this.discard.pop(); break;
      case "moDan":
        this.log.push(`${actor.name}使用${cardName(card)}`);
        return this.magicBullet(actorId, card, options);
      default: throw new RuleError(`尚未实现 ${card.name}`);
    }
    this.log.push(`${actor.name}对${target.name}使用${cardName(card)}`);
  }

  attack(actorId, handIndex, targetId, options = {}) {
    const actor = this.player(actorId), target = this.player(targetId);
    if (actor.team === target.team) throw new RuleError("攻击只能指定对手");
    const attack = this.discardCard(actor, handIndex);
    this.log.push(`${actor.name}使用主动攻击${cardName(attack)}，目标是${target.name}`);
    return this.resolveAttack(actorId, targetId, attack, options, false);
  }

  async attackWithDecisions(actorId, handIndex, targetId, {
    overflow = "first",
    chooseResponse,
    chooseTarget,
  } = {}) {
    let actor = this.player(actorId);
    let target = this.player(targetId);
    if (actor.team === target.team) throw new RuleError("攻击只能指定对手");
    let attack = this.discardCard(actor, handIndex);
    let isCounter = false;
    this.log.push(`${actor.name}使用主动攻击${cardName(attack)}，目标是${target.name}`);

    while (true) {
      const counterTargets = this.players.filter(player => player.team !== target.team && player.id !== actor.id);
      const valid = target.hand.map((card, index) => ({ card, index })).filter(item => {
        if (!this.canRespond(attack, item.card)) return false;
        return item.card.name === "shengGuang" || counterTargets.length > 0;
      });

      let decision = null;
      if (valid.length) {
        decision = chooseResponse
          ? await chooseResponse({ actor, target, attack, valid, counterTargets, isCounter })
          : null;
      }

      if (!decision) {
        this.resolveUnansweredAttack(actor.id, target.id, attack, { overflow }, isCounter);
        return;
      }

      const picked = valid.find(item => item.index === decision.index);
      if (!picked) throw new RuleError("选择的牌不能应战此次攻击");
      const response = this.discardCard(target, picked.index);
      if (response.name === "shengGuang") {
        this.log.push(`${target.name}使用${cardName(response)}抵消攻击，原攻击未命中`);
        return;
      }

      this.log.push(`${target.name}使用应战攻击${cardName(response)}，原攻击未命中`);
      let nextTargetId = decision.targetId;
      if (nextTargetId == null && chooseTarget) {
        nextTargetId = await chooseTarget({ actor: target, previousActor: actor, attack: response, targets: counterTargets });
      }
      const nextTarget = counterTargets.find(player => player.id === nextTargetId);
      if (!nextTarget) throw new RuleError("应战攻击目标不合法");
      this.log.push(`${target.name}的应战攻击目标是${nextTarget.name}`);
      actor = target;
      target = nextTarget;
      attack = response;
      isCounter = true;
    }
  }

  resolveAttack(actorId, targetId, attack, { responseIndex = null, responseTargetId = null, responses = {}, overflow = "first", useHealing = 0, autoRespond = false } = {}, isCounter = false) {
    const actor = this.player(actorId), target = this.player(targetId);
    const configured = responses[targetId];
    let selectedIndex = configured?.index ?? responseIndex;
    let selectedTarget = configured?.targetId ?? responseTargetId;
    const mayAutoRespond = typeof autoRespond === "function" ? autoRespond(target.id) : autoRespond;
    if (selectedIndex == null && mayAutoRespond) {
      const counterTargets = this.players.filter(p => p.team !== target.team && p.id !== actor.id);
      const valid = target.hand.map((card, index) => ({ card, index })).filter(x => {
        if (!this.canRespond(attack, x.card)) return false;
        return x.card.name === "shengGuang" || counterTargets.length > 0;
      });
      if (valid.length) {
        const picked = valid[Math.floor(this.random() * valid.length)];
        selectedIndex = picked.index;
        if (ATTACKS.has(picked.card.name)) {
          selectedTarget = counterTargets[Math.floor(this.random() * counterTargets.length)].id;
        }
      }
    }
    if (selectedIndex !== null && selectedIndex !== undefined) {
      const response = target.hand[selectedIndex];
      if (!response || !this.canRespond(attack, response)) throw new RuleError("该牌不能应战此次攻击");
      this.discardCard(target, selectedIndex);
      if (response.name === "shengGuang") this.log.push(`${target.name}使用${cardName(response)}抵消攻击，原攻击未命中`);
      else this.log.push(`${target.name}使用应战攻击${cardName(response)}，原攻击未命中`);
      if (ATTACKS.has(response.name)) {
        const nextTarget = this.player(selectedTarget);
        if (nextTarget.team === target.team || nextTarget.id === actor.id) throw new RuleError("应战攻击须指定原攻击者之外的对手");
        this.log.push(`${target.name}的应战攻击目标是${nextTarget.name}`);
        return this.resolveAttack(target.id, nextTarget.id, response, { responses, overflow, autoRespond }, true);
      }
      return;
    }
    this.resolveUnansweredAttack(actorId, targetId, attack, { overflow, useHealing }, isCounter);
  }

  resolveUnansweredAttack(actorId, targetId, card, options, isCounter) {
    this.log.push(`${this.player(actorId).name}的${cardName(card)}命中${this.player(targetId).name}`);
    const shielded = Boolean(this.player(targetId).shield);
    this.damage(targetId, 2, { ...options, sourceId: actorId, shieldable: true });
    if (!shielded) {
      const team = this.player(actorId).team;
      const stone = isCounter ? "crystal" : "gem";
      const added = this.addStones(team, stone);
      this.log.push(`${isCounter ? "应战攻击" : "主动攻击"}命中，${this.player(actorId).name}一方战绩区${added ? `获得1个${stone === "gem" ? "宝石" : "水晶"}` : "已满5个星石，未增加星石"}`);
    }
  }

  nearestOpponent(fromId, excluded = new Set()) {
    const from = this.player(fromId);
    for (let n = 1; n < this.players.length; n++) {
      const candidate = this.players[(fromId + n) % this.players.length];
      if (candidate.team !== from.team && !excluded.has(candidate.id)) return candidate;
    }
    return null;
  }

  magicBullet(actorId, card, { responses = {}, overflow = "first", autoRespond = false } = {}) {
    let targetedThisRound = new Set([actorId]);
    let sourceId = actorId, damage = 2;
    while (true) {
      let target = this.nearestOpponent(sourceId, targetedThisRound);
      if (!target) {
        targetedThisRound = new Set();
        this.log.push("所有玩家均已被魔弹指定，刷新魔弹指定记录");
        target = this.nearestOpponent(sourceId, targetedThisRound);
      }
      if (!target) return;
      targetedThisRound.add(target.id);
      let responseIndex = responses[target.id];
      const mayAutoRespond = typeof autoRespond === "function" ? autoRespond(target.id) : autoRespond;
      if (responseIndex === undefined && mayAutoRespond) {
        const valid = target.hand.map((card, index) => ({ card, index })).filter(x => x.card.name === "moDan" || x.card.name === "shengGuang");
        if (valid.length) responseIndex = valid[Math.floor(this.random() * valid.length)].index;
      }
      const response = responseIndex === undefined ? null : target.hand[responseIndex];
      if (response?.name === "shengGuang") {
        this.discardCard(target, responseIndex);
        this.log.push(`${target.name}用${cardName(response)}抵消${cardName("moDan")}`); return;
      }
      if (response?.name === "moDan") {
        this.discardCard(target, responseIndex); damage++; sourceId = target.id;
        this.log.push(`${target.name}用${cardName(response)}传递${cardName("moDan")}，伤害增至${damage}`); continue;
      }
      this.damage(target.id, damage, { sourceId, magic: true, overflow, shieldable: true });
      return;
    }
  }

  startTurn(playerId, { weakness = "skip", overflow = "first", poisonHealing = 0 } = {}) {
    const player = this.player(playerId);
    for (const poison of player.poisons.splice(0)) {
      this.damage(playerId, 1, { sourceId: poison.sourceId, magic: true, overflow, useHealing: poisonHealing });
      this.discard.push(poison.card);
    }
    if (player.weakness) {
      const weaknessCard = player.weakness;
      this.log.push(`${player.name}回合开始，触发${cardName(weaknessCard)}`);
      this.discard.push(weaknessCard);
      player.weakness = null;
      if (weakness === "draw") {
        this.draw(playerId, 3, { overflow });
        this.log.push(`${player.name}选择摸3张牌取消${cardName(weaknessCard)}，本回合继续行动`);
        return { skipped: false };
      }
      this.log.push(`${player.name}选择不摸牌，因${cardName(weaknessCard)}跳过本回合行动`);
      return { skipped: true };
    }
    return { skipped: false };
  }
}
