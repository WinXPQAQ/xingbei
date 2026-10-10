import { cardName, createDeck } from "./cards.js";

import { RuleError } from "./errors.js";
export { RuleError } from "./errors.js";
import { Card } from "./card.js";
import { Player } from "./player.js";
import { createDefaultHero } from "./hero.js";
import { BASIC_EFFECTS } from "./effects.js";
import { TurnFlow } from "./turn.js";
import { Timing } from "./timing.js";
import { resolveSync, resolveAsync } from "./resolution/decisions.js";
export { Timing } from "./timing.js";

export const DEFAULT_NAMES = ["红一", "蓝一", "蓝二", "红二", "红三", "蓝三"];
export const DEFAULT_TEAMS = ["red", "blue", "blue", "red", "red", "blue"];

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

export const DamageType = Object.freeze({ ATTACK: "attack", SPELL: "spell" });
export const DiscardVisibility = Object.freeze({ PUBLIC: "public", HIDDEN: "hidden" });

export class Game {
  constructor({ names = DEFAULT_NAMES, teams = DEFAULT_TEAMS, seed = Date.now(), shuffleDeck = true } = {}) {
    if (names.length !== 6 || teams.length !== 6 || teams.filter(team => team === "red").length !== 3 || teams.filter(team => team === "blue").length !== 3) throw new RuleError("当前对局需要6名玩家，红蓝各3人");
    this.random = seededRandom(seed);
    this.players = names.map((name, seat) => new Player({ id: seat, name, team: teams[seat], hero: createDefaultHero(seat) }));
    this.teams = { red: { morale: 15, achievements: [], cups: 0 }, blue: { morale: 15, achievements: [], cups: 0 } };
    this.deck = []; this.discard = []; this.field = []; this.outside = [];
    this.cards = new Map();
    this.effects = new Map(Object.entries(BASIC_EFFECTS));
    this.skillDefinitions = new Map();
    this.presentationEnabled = false; this.presentationEvents = []; this.presentationSequence = 0;
    this.turn = new TurnFlow(this); this.timeline = [];
    for (const card of createDeck()) this.registerCard(card, { zone: "deck" });
    if (shuffleDeck) shuffle(this.deck, this.random);
    this.current = 0;
    this.winner = null;
    this.log = [];
  }

  enablePresentation(onPresentation) { this.presentationEnabled = true; this.presentationEvents = []; this.onPresentation = onPresentation; }

  recordPresentation(type, data = {}) {
    if (!this.presentationEnabled) return;
    // Detached checkpoint snapshots prevent later rule steps leaking into a frame.
    const view = {
      players: this.players.map(player => ({ ...player.toJSON(), hand: player.hand.map(card => ({ ...card.toJSON(), ...card.getTraits({ game: this, playerId: player.id, purpose: "hand" }) })) })),
      teams: this.teams, current: this.current, winner: this.winner,
      deckCount: this.deck.length, discardCount: this.discard.length,
    };
    this.presentationEvents.push(JSON.parse(JSON.stringify({ sequence: ++this.presentationSequence, type, ...data, view })));
  }

  *present() {
    if (this.presentationEvents.length) yield { type: "presentation", events: this.presentationEvents.splice(0) };
  }

  flushPresentation() {
    return resolveAsync(this.present(), () => null, this.onPresentation);
  }

  zone(location) {
    if (!location || !["deck", "discard", "hand", "field", "status", "outside"].includes(location.zone)) throw new RuleError("无效的牌区域");
    if (["hand", "status"].includes(location.zone)) {
      if (!Number.isInteger(location.playerId)) throw new RuleError("玩家区域需要明确玩家编号");
      const player = this.player(location.playerId);
      return location.zone === "hand" ? player.hand : player.statuses;
    }
    if (location.playerId != null) throw new RuleError("公共区域不能指定玩家");
    return { deck: this.deck, discard: this.discard, field: this.field, outside: this.outside }[location.zone];
  }

  registerCard(card, location) {
    if (!(card instanceof Card) || this.cards.has(card.id) || card.location) throw new RuleError("牌必须是尚未注册的唯一实体");
    if (card.category === "basic" && location?.zone !== "deck") throw new RuleError("基础牌注册时必须在抽牌堆");
    const destination = this.zone(location);
    if (location.zone === "status" && !this.canAttach(card, location.playerId, card.attachment?.effectId ?? card.name)) throw new RuleError("不能重复挂载该效果");
    this.cards.set(card.id, card);
    card.setLocation(location);
    if (location.zone === "status" && !card.attachment) card.attachment = { effectId: card.name, sourcePlayerId: null, sourceSkillId: null, data: {} };
    destination.push(card);
    return card;
  }

  moveCard(cardId, destination, { animate = true, reason = null, targetId = null, visibility = DiscardVisibility.PUBLIC } = {}) {
    if (!Object.values(DiscardVisibility).includes(visibility)) throw new RuleError("无效的弃牌可见性");
    const card = this.cards.get(cardId);
    if (!card) throw new RuleError(`不存在牌 ${cardId}`);
    const next = this.zone(destination), previous = this.zone(card.location);
    if (destination.zone === "status") {
      if (!card.attachment || !this.canAttach(card, destination.playerId, card.attachment.effectId)) throw new RuleError("状态区需要合法且不重复的挂载效果");
    }
    const from = card.location;
    const index = previous.indexOf(card);
    if (index < 0) throw new RuleError("牌位置与区域不一致");
    previous.splice(index, 1); next.push(card);
    card.setLocation(destination);
    card.discardVisibility = destination.zone === "discard" ? visibility : null;
    if (destination.zone !== "status") card.attachment = null;
    if (animate) this.recordPresentation("move", { card: card.toJSON(), from, to: card.location, reason, targetId, visibility });
    return card;
  }

  registerEffect(id, definition) {
    if (this.effects.has(id)) throw new RuleError(`效果已注册 ${id}`);
    this.effects.set(id, { category: "basic", stackable: false, priority: 0, timings: [], ...definition });
  }

  canAttach(card, playerId, effectId) {
    const player = this.player(playerId), definition = this.effects.get(effectId);
    if (card.category === "basic" && (!definition || definition.category !== "basic")) return false;
    return card.category === "exclusive" || definition.stackable || !player.getStatus(effectId).some(existing => existing !== card);
  }

  attachCard(cardId, playerId, { effectId, sourcePlayerId = null, sourceSkillId = null, data = {} }) {
    const card = this.cards.get(cardId);
    if (!card || !this.canAttach(card, playerId, effectId)) throw new RuleError("目标已有该基础效果或效果未注册");
    const previous = card.attachment;
    card.attachment = { effectId, sourcePlayerId, sourceSkillId, data: { ...data } };
    try { return this.moveCard(card.id, { zone: "status", playerId }); }
    catch (error) { card.attachment = previous; throw error; }
  }

  removeEffect(cardId, destination = { zone: "discard" }) {
    const card = this.cards.get(cardId);
    if (card?.location.zone !== "status") throw new RuleError("这张牌没有挂载效果");
    return this.moveCard(cardId, destination);
  }

  registerSkill(id, definition) {
    if (this.skillDefinitions.has(id)) throw new RuleError(`技能已注册 ${id}`);
    this.skillDefinitions.set(id, { priority: 0, ...definition, id });
  }

  modifyTraits(card, printed, context) {
    let traits = { elements: [...printed.elements], fates: [...printed.fates] };
    const modifiers = this.players.flatMap(player => player.getSkills(context).map(source => ({ ...source, player })))
      .map(source => ({ ...source, definition: typeof source.skill === "string" ? this.skillDefinitions.get(source.skill) : source.skill }))
      .filter(source => source.definition?.modifyTraits).sort((a, b) => (a.definition.priority ?? 0) - (b.definition.priority ?? 0));
    for (const { definition, player, sourceCard } of modifiers) {
      if (definition.filter && !definition.filter({ game: this, player, card, sourceCard, context, ...context })) continue;
      traits = definition.modifyTraits({ game: this, player, card, sourceCard, context, ...context }, traits) ?? traits;
    }
    return { elements: [...new Set(traits.elements)], fates: [...new Set(traits.fates)] };
  }

  *trigger(timing, context, options = {}) {
    yield* this.present();
    this.timeline.push({ timing, playerId: context.playerId ?? context.targetId, cardId: context.card?.id ?? null });
    const ownerId = context.playerId ?? context.targetId;
    const effects = ownerId == null ? [] : this.player(ownerId).statuses.map(card => ({ card, player: this.player(ownerId), definition: this.effects.get(card.attachment.effectId) }));
    const skills = this.players.flatMap(player => player.getSkills(context).map(({ skill, sourceCard }) => ({ player, sourceCard, definition: typeof skill === "string" ? this.skillDefinitions.get(skill) : skill })));
    const entries = [...effects, ...skills].filter(entry => entry.definition?.timings?.includes(timing))
      .sort((a, b) => (b.definition.priority ?? 0) - (a.definition.priority ?? 0));
    for (const entry of entries) {
      if (entry.card && (entry.card.location.zone !== "status" || entry.card.location.playerId !== entry.player.id || this.effects.get(entry.card.attachment.effectId) !== entry.definition)) continue;
      if (entry.sourceCard && (entry.sourceCard.location.zone !== "status" || entry.sourceCard.location.playerId !== entry.player.id)) continue;
      const payload = { game: this, timing, context, options, ...entry };
      if (entry.definition.filter && !entry.definition.filter(payload)) continue;
      if (entry.card) {
        this.recordPresentation("effect", { playerId: entry.player.id, card: entry.card.toJSON(), effectId: entry.card.attachment.effectId });
        yield* this.present();
      }
      const result = entry.definition.resolve?.(payload);
      if (result?.next) yield* result;
      else if (result?.then) yield { type: "promise", promise: result };
      yield* this.present();
      if (this.winner) break;
    }
  }

  assertCardLocations() {
    const seen = new Set();
    for (const location of [{ zone: "deck" }, { zone: "discard" }, { zone: "field" }, { zone: "outside" }, ...this.players.flatMap(player => [{ zone: "hand", playerId: player.id }, { zone: "status", playerId: player.id }])]) {
      for (const card of this.zone(location)) {
        if (seen.has(card.id) || this.cards.get(card.id) !== card || JSON.stringify(card.location) !== JSON.stringify(location)) throw new RuleError("牌登记或位置不一致");
        if (location.zone !== "status" && card.attachment) throw new RuleError("非状态区牌不能承载挂载效果");
        seen.add(card.id);
      }
    }
    if (seen.size !== this.cards.size) throw new RuleError("登记牌不在任何区域");
    return true;
  }

  toJSON() {
    return { players: this.players, teams: this.teams, deck: this.deck, discard: this.discard, field: this.field, outside: this.outside,
      current: this.current, winner: this.winner, log: this.log, turn: this.turn.state, timeline: this.timeline };
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
    const cards = [];
    for (let i = 0; i < count; i++) {
      if (!this.deck.length) {
        if (!this.discard.length) break;
        for (const card of [...this.discard]) this.moveCard(card.id, { zone: "deck" }, { animate: false });
        this.recordPresentation("shuffle");
        shuffle(this.deck, this.random);
        this.log.push("弃牌堆洗回牌库");
      }
      cards.push(this.moveCard(this.deck.at(-1).id, { zone: "hand", playerId: id }, { animate: false }).toJSON());
    }
    if (cards.length) this.recordPresentation("draw", { playerId: id, cards });
    const excess = Math.max(0, player.hand.length - player.handLimit);
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
    const excess = Math.max(0, player.hand.length - player.handLimit);
    if (!excess) { delete player.pendingOverflow; return []; }
    if (!Array.isArray(indexes) || indexes.length !== excess || new Set(indexes).size !== excess ||
        indexes.some(index => !Number.isInteger(index) || index < 0 || index >= player.hand.length)) {
      throw new RuleError(`爆牌必须选择${excess}张不同的合法手牌`);
    }
    const discarded = [...indexes].sort((a, b) => b - a).map(index => this.discardCard(player, index, { animate: false, visibility: DiscardVisibility.HIDDEN }));
    this.recordPresentation("discard", { playerId: id, cards: discarded.map(card => card.toJSON()), visibility: DiscardVisibility.HIDDEN, reason: "overflow" });
    if (moraleLoss) this.changeMorale(player.team, -excess);
    delete player.pendingOverflow;
    this.log.push(`${player.name}爆牌，暗弃${discarded.length}张手牌；己方士气-${moraleLoss ? excess : 0}`);
    return discarded;
  }

  discardCard(player, index, options = {}) {
    if (!Number.isInteger(index) || index < 0 || index >= player.hand.length) throw new RuleError("无效的手牌编号");
    return this.moveCard(player.hand[index].id, { zone: "discard" }, options);
  }

  playCard(player, index, options = {}) {
    if (!Number.isInteger(index) || !player.hand[index]) throw new RuleError("无效的手牌编号");
    const card = this.moveCard(player.hand[index].id, { zone: "field" }, { reason: "play", targetId: options.targetId });
    options.resolutionCards?.push(card.id);
    return card;
  }

  changeMorale(team, amount) {
    this.teams[team].morale = Math.min(15, this.teams[team].morale + amount);
    this.recordPresentation("morale", { team, amount });
    this.checkWinner();
  }

  checkWinner() {
    const previous = this.winner;
    if (this.teams.red.morale <= 0 || this.teams.blue.cups >= 5) this.winner = "blue";
    if (this.teams.blue.morale <= 0 || this.teams.red.cups >= 5) this.winner = "red";
    if (this.winner && !previous) this.recordPresentation("winner", { team: this.winner });
    return this.winner;
  }

  legalTargets(actorId, card) {
    return card.legalTargets({ game: this, actor: this.player(actorId) });
  }

  legalCards(actorId) {
    return this.player(actorId).hand
      .map((card, index) => ({ card, index, targets: this.legalTargets(actorId, card) }))
      .filter(action => action.targets.length);
  }

  unusableCards(actorId) {
    return this.player(actorId).hand.filter(card => !this.legalTargets(actorId, card).length);
  }

  canRefreshUnableHand(actorId) {
    const player = this.player(actorId);
    return player.handLimit - player.hand.length <= 2 &&
      this.unusableCards(actorId).length === player.hand.length && !player.hero.canActWithSkills;
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
    if (added) this.recordPresentation("stones", { team, kind: type, amount: added });
    return added;
  }

  validateStoneRemoval(team, { gem = 0, crystal = 0 }) {
    const counts = this.stoneCounts(team);
    if (!Number.isInteger(gem) || !Number.isInteger(crystal) || gem < 0 || crystal < 0 || gem > counts.gem || crystal > counts.crystal) throw new RuleError("战绩区没有足够的星石");
  }

  removeStones(team, { gem = 0, crystal = 0 }) {
    this.validateStoneRemoval(team, { gem, crystal });
    for (const [type, count] of [["gem", gem], ["crystal", crystal]]) {
      for (let i = 0; i < count; i++) {
        const index = this.teams[team].achievements.indexOf(type);
        this.teams[team].achievements.splice(index, 1);
      }
    }
    this.recordPresentation("stones", { team, amount: -(gem + crystal), gem, crystal });
  }

  purchase(actorId, options = {}) { return resolveSync(this.purchaseSteps(actorId, options), () => null); }
  synthesize(actorId, gemCount, options = {}) { return resolveSync(this.synthesizeSteps(actorId, gemCount, options), () => null); }
  refine(actorId, stones) { return resolveSync(this.refineSteps(actorId, stones), () => null); }
  refreshUnableHand(actorId) { return resolveSync(this.refreshUnableHandSteps(actorId), () => null); }
  executeAction(actorId, action, options = {}) {
    if (action.type === "play") return this.playWithDecisions(actorId, action.index, action.targetId, options);
    let steps;
    if (action.type === "purchase") steps = this.purchaseSteps(actorId, options);
    else if (action.type === "synthesize") steps = this.synthesizeSteps(actorId, action.gemCount, options);
    else if (action.type === "refine") steps = this.refineSteps(actorId, action.stones);
    else if (action.type === "refresh") steps = this.refreshUnableHandSteps(actorId);
    else throw new RuleError("未知行动");
    return resolveAsync(steps, request => this.interactiveDecision(request, options), options.onPresentation ?? this.onPresentation);
  }

  *purchaseSteps(actorId, options = {}) {
    if (!this.canDrawSpecial(actorId)) throw new RuleError("购买只能在手牌为0至3张时执行");
    if (this.winner) throw new RuleError("游戏已经结束");
    yield* this.turn.beginAction(actorId, "special");
    this.draw(actorId, 3, options);
    const player = this.player(actorId);
    const gems = this.addStones(player.team, "gem");
    const crystals = this.addStones(player.team, "crystal");
    this.log.push(`${player.name}执行购买，摸3张牌；己方战绩区获得${gems}个宝石和${crystals}个水晶${gems + crystals < 2 ? "（战绩区上限5个）" : ""}`);
    yield* this.present();
    if (this.player(actorId).pendingOverflow) yield { type: "overflow", player: this.player(actorId) };
    yield* this.present();
    yield* this.turn.endAction();
  }

  *synthesizeSteps(actorId, gemCount, options = {}) {
    if (!this.canDrawSpecial(actorId)) throw new RuleError("合成只能在手牌为0至3张时执行");
    const player = this.player(actorId);
    const counts = this.stoneCounts(player.team);
    if (counts.total < 3) throw new RuleError("合成需要3个星石");
    if (!Number.isInteger(gemCount) || gemCount < 0 || gemCount > 3) throw new RuleError("合成的宝石数量必须为0至3");
    const crystalCount = 3 - gemCount;
    this.validateStoneRemoval(player.team, { gem: gemCount, crystal: crystalCount });
    if (this.winner) throw new RuleError("游戏已经结束");
    yield* this.turn.beginAction(actorId, "special");
    this.removeStones(player.team, { gem: gemCount, crystal: crystalCount });
    this.draw(actorId, 3, options);
    this.teams[player.team].cups++;
    this.recordPresentation("cup", { team: player.team, playerId: actorId, amount: 1 });
    const enemyTeam = player.team === "red" ? "blue" : "red";
    this.changeMorale(enemyTeam, -1);
    this.log.push(`${player.name}消耗${gemCount}个宝石、${crystalCount}个水晶执行合成，摸3张牌；己方星杯+1，对方士气-1`);
    this.checkWinner();
    yield* this.present();
    if (this.player(actorId).pendingOverflow) yield { type: "overflow", player: this.player(actorId) };
    yield* this.present();
    yield* this.turn.endAction();
  }

  *refineSteps(actorId, { gem = 0, crystal = 0 }) {
    const player = this.player(actorId);
    const total = gem + crystal;
    if (!Number.isInteger(gem) || !Number.isInteger(crystal) || total < 1 || total > 2) {
      throw new RuleError("提炼必须选择1至2个星石");
    }
    if (player.energy.gem + player.energy.crystal + total > 3) throw new RuleError("角色能量上限为3");
    this.validateStoneRemoval(player.team, { gem, crystal });
    if (this.winner) throw new RuleError("游戏已经结束");
    yield* this.turn.beginAction(actorId, "special");
    this.removeStones(player.team, { gem, crystal });
    player.energy.gem += gem;
    player.energy.crystal += crystal;
    this.recordPresentation("energy", { playerId: actorId, gem, crystal });
    this.log.push(`${player.name}提炼${gem}个宝石、${crystal}个水晶；个人能量变为${player.energy.gem}宝石、${player.energy.crystal}水晶`);
    yield* this.present();
    if (this.player(actorId).pendingOverflow) yield { type: "overflow", player: this.player(actorId) };
    yield* this.present();
    yield* this.turn.endAction();
  }

  *refreshUnableHandSteps(actorId) {
    const player = this.player(actorId);
    if (!this.canRefreshUnableHand(actorId)) throw new RuleError("未满足无法行动条件");
    if (this.winner) throw new RuleError("游戏已经结束");
    yield* this.turn.beginAction(actorId, "special");
    const count = player.hand.length;
    const revealed = player.hand.map(cardName).join("、");
    const cards = player.hand.map(card => card.toJSON());
    while (player.hand.length) this.discardCard(player, 0, { animate: false });
    this.recordPresentation("discard", { playerId: actorId, cards, reason: "refresh", visibility: DiscardVisibility.PUBLIC });
    this.draw(actorId, count, { moraleLoss: false });
    this.log.push(`${player.name}无法行动，展示并弃置全部手牌：${revealed}；重摸${count}张`);
    yield* this.present();
    if (this.player(actorId).pendingOverflow) yield { type: "overflow", player: this.player(actorId) };
    yield* this.present();
    yield* this.turn.endAction();
  }

  *damageSteps(targetId, amount, { sourceId = null, damageType = DamageType.ATTACK, overflow = "first", useHealing = 0 } = {}) {
    const target = this.player(targetId);
    if (!Object.values(DamageType).includes(damageType)) throw new RuleError("无效的伤害类别");
    const context = { targetId, sourceId, amount, damageType };
    yield* this.trigger(Timing.DAMAGE_BEFORE, context, { overflow });
    const healing = Math.min(Math.max(0, context.amount), target.healing, Math.max(0, useHealing));
    target.healing -= healing;
    if (healing) this.recordPresentation("healing", { playerId: targetId, amount: -healing });
    context.actual = Math.max(0, context.amount - healing);
    this.recordPresentation("damage", { playerId: targetId, sourceId, amount: context.actual, damageType: context.damageType });
    yield* this.present();
    if (context.actual) this.draw(targetId, context.actual, { overflow });
    yield* this.present();
    this.log.push(`${target.name}承受${context.actual}点${context.damageType === DamageType.SPELL ? "法术" : "攻击"}伤害`);
    yield* this.trigger(Timing.DAMAGE_AFTER, context, { overflow });
    return context.actual;
  }
  damage(targetId, amount, options = {}) { return resolveSync(this.damageSteps(targetId, amount, options), () => null); }

  canRespond(attack, response, context = {}) {
    return attack.canRespond(response, { game: this, ...context });
  }

  *actionSteps(actorId, handIndex, targetId, options = {}) {
    if (this.winner) throw new RuleError("游戏已经结束");
    const actor = this.player(actorId), card = actor.hand[handIndex];
    if (!card || !this.legalTargets(actorId, card).includes(targetId)) throw new RuleError("这张牌目前不能指定该目标");
    yield* this.turn.beginAction(actorId, card.type);
    const resolutionCards = [];
    const result = card.resolve({ game: this, actor, targetId, options: { ...options, resolutionCards } });
    if (result?.next) yield* result;
    else if (result?.then) yield { type: "promise", promise: result };
    for (const id of resolutionCards) {
      if (this.cards.get(id).location.zone === "field") this.moveCard(id, { zone: "discard" }, { animate: false });
    }
    if (resolutionCards.length) this.recordPresentation("cleanup", { cardIds: resolutionCards, visibility: DiscardVisibility.PUBLIC });
    if (card.type !== "attack" && card.name !== "magicBullet") this.log.push(`${actor.name}对${this.player(targetId).name}使用${cardName(card)}`);
    if (actor.pendingOverflow) yield { type: "overflow", player: actor };
    yield* this.present();
    yield* this.turn.endAction();
  }
  play(actorId, handIndex, targetId, options = {}) {
    return resolveSync(this.actionSteps(actorId, handIndex, targetId, options), request => this.automaticDecision(request, options));
  }
  playWithDecisions(actorId, handIndex, targetId, options = {}) {
    return resolveAsync(this.actionSteps(actorId, handIndex, targetId, options), request => this.interactiveDecision(request, options), options.onPresentation ?? this.onPresentation);
  }

  automaticDecision(request, options = {}) {
    if (request.type !== "response") return options.choose?.(request) ?? null;
    const { target, valid } = request;
    const configured = options.responses?.[target.id];
    let decision = typeof configured === "number" ? { index: configured } : configured;
    if (!decision && !request.isCounter && options.responseIndex != null) decision = { index: options.responseIndex, targetId: options.responseTargetId };
    const automatic = typeof options.autoRespond === "function" ? options.autoRespond(target.id) : options.autoRespond;
    if (!decision && automatic && valid.length) {
      const picked = valid[Math.floor(this.random() * valid.length)];
      decision = { index: picked.index };
      if (picked.card.type === "attack") decision.targetId = request.counterTargets[Math.floor(this.random() * request.counterTargets.length)].id;
    }
    return decision ?? null;
  }

  attack(actorId, handIndex, targetId, options = {}) {
    if (this.player(actorId).hand[handIndex]?.type !== "attack") throw new RuleError("请选择攻击牌");
    return resolveSync(this.actionSteps(actorId, handIndex, targetId, options), request => this.automaticDecision(request, options));
  }

  attackWithDecisions(actorId, handIndex, targetId, options = {}) {
    if (this.player(actorId).hand[handIndex]?.type !== "attack") throw new RuleError("请选择攻击牌");
    return resolveAsync(this.actionSteps(actorId, handIndex, targetId, options), request => this.interactiveDecision(request, options), options.onPresentation ?? this.onPresentation);
  }

  interactiveDecision(request, options) {
    if (request.type === "response") return options.chooseResponse?.(request) ?? this.automaticDecision(request, options);
    if (request.type === "target") return options.chooseTarget?.(request);
    if (request.type === "overflow") return options.resolveOverflow?.(request);
    return options.choose?.(request);
  }

  nearestOpponent(fromId, excluded = new Set()) {
    const from = this.player(fromId);
    for (let n = 1; n < this.players.length; n++) {
      const candidate = this.players[(fromId + n) % this.players.length];
      if (candidate.team !== from.team && !excluded.has(candidate.id)) return candidate;
    }
    return null;
  }

  playMagicWithDecisions(actorId, handIndex, options = {}) {
    if (this.player(actorId).hand[handIndex]?.name !== "magicBullet") throw new RuleError("请选择魔弹");
    return resolveAsync(this.actionSteps(actorId, handIndex, this.nearestOpponent(actorId)?.id, options), request => this.interactiveDecision(request, options), options.onPresentation ?? this.onPresentation);
  }

  magicTarget(sourceId, participants) {
    return this.nearestOpponent(sourceId, participants.size === this.players.length ? new Set() : participants);
  }

  startTurn(playerId, options = {}) {
    return resolveSync(this.turn.start(playerId, options), request => request.type === "weakness" ? options.weakness ?? "skip" : null);
  }

  async beginTurn(playerId, decisions = {}, options = {}) {
    return resolveAsync(this.turn.start(playerId, options), request => {
      if (request.type === "weakness") return decisions.chooseWeakness?.(request) ?? "skip";
      if (request.type === "overflow") return decisions.resolveOverflow?.(request);
      return decisions.choose?.(request);
    }, decisions.onPresentation ?? this.onPresentation);
  }
  beginAction(playerId, actionType) { return resolveSync(this.turn.beginAction(playerId, actionType), () => null); }
  endAction() { return resolveSync(this.turn.endAction(), () => null); }
  endTurn() { return resolveSync(this.turn.end(), () => null); }
  endTurnWithDecisions(options = {}) { return resolveAsync(this.turn.end(), request => this.interactiveDecision(request, options), options.onPresentation ?? this.onPresentation); }
}
