import { PublicHistory } from "./ai/public-history.js";
import { logCard, skillLabel, effectLabel } from "./action-log.js";
import { chooseAiDiscard, chooseAiResponse, chooseAiRuleDecision } from "./ai.js";
import { initializeSealer } from "./heroes/sealer.js";
import { cardName, createDeck } from "./cards.js";

import { RuleError } from "./errors.js";
export { RuleError } from "./errors.js";
import { Card } from "./card.js";
import { Player } from "./player.js";
import { createDefaultHero, createHero, createHeroRoster } from "./hero.js";
import { BASIC_EFFECTS } from "./effects.js";
import { TurnFlow } from "./turn.js";
import { Timing } from "./timing.js";
import { TriggerRegistry } from "./triggers.js";
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
  constructor({ names = DEFAULT_NAMES, teams = DEFAULT_TEAMS, seed = Date.now(), shuffleDeck = true, heroRules = true, heroIds = null, playerHeroId = null, playerSeat = 0, revealHiddenLogs = false } = {}) {
    if (names.length !== 6 || teams.length !== 6 || teams.filter(team => team === "red").length !== 3 || teams.filter(team => team === "blue").length !== 3) throw new RuleError("当前对局需要6名玩家，红蓝各3人");
    if (playerHeroId != null) {
      if (heroIds != null) throw new RuleError("不能同时指定玩家角色与完整角色阵容");
      try { heroIds = createHeroRoster(playerHeroId, playerSeat); }
      catch (error) { throw new RuleError(error.message); }
    }
    this.random = seededRandom(seed);
    this.publicHistory = new PublicHistory();
    this.players = names.map((name, seat) => new Player({ id: seat, name, team: teams[seat], hero: heroIds ? createHero(heroIds[seat], heroRules) : createDefaultHero(seat, heroRules) }));
    this.teams = { red: { morale: 15, achievements: [], cups: 0 }, blue: { morale: 15, achievements: [], cups: 0 } };
    this.deck = []; this.discard = []; this.field = []; this.outside = [];
    this.cards = new Map();
    this.effects = new Map(Object.entries(BASIC_EFFECTS));
    this.skillDefinitions = new Map(); this.pendingRuleEvents = []; this.processingRuleEvents = false;
    this.triggers = new TriggerRegistry(this);
    this.presentationEnabled = false; this.presentationEvents = []; this.presentationSequence = 0;
    this.turn = new TurnFlow(this); this.timeline = [];
    for (const card of createDeck()) this.registerCard(card, { zone: "deck" });
    if (shuffleDeck) shuffle(this.deck, this.random);
    this.current = 0;
    this.winner = null;
    this.log = [];
    this.revealHiddenLogs = revealHiddenLogs;
    initializeSealer(this);
    for (const player of this.players) {
      this.triggers.registerHero(player);
      player.hero.onSkillsChanged = () => this.triggers.registerHero(player);
    }
  }

  actorLabel(playerId) { const player = this.player(playerId); return `${player.hero.name}（${player.name}）`; }
  describeCards(cards, playerId, { hidden = false } = {}) {
    return hidden && !this.revealHiddenLogs ? "" : `（${cards.map(card => logCard(card, this, playerId)).join("、")}）`;
  }
  logSkill(playerId, skillId, detail) {
    this.log.push(`${this.actorLabel(playerId)}发动【${skillLabel(this.player(playerId), skillId)}】${detail ? `：${detail}` : ""}`);
  }
  giveCards(playerId, targetId, cards) {
    if (cards.some(card => card.location.zone !== "hand" || card.location.playerId !== playerId)) throw new RuleError("交出的牌必须来自本人手牌");
    const detail = this.describeCards(cards, playerId, { hidden: true });
    for (const card of cards) this.moveCard(card.id, { zone: "hand", playerId: targetId });
    this.log.push(`${this.actorLabel(playerId)}将${cards.length === 1 ? "一" : cards.length}张牌${detail}交给了${this.actorLabel(targetId)}`);
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
    if (location.zone === "status") this.triggers.registerCard(card);
    return card;
  }

  moveCard(cardId, destination, { animate = true, reason = null, targetId = null, visibility = DiscardVisibility.PUBLIC, covered = false } = {}) {
    if (!Object.values(DiscardVisibility).includes(visibility)) throw new RuleError("无效的弃牌可见性");
    const card = this.cards.get(cardId);
    if (!card) throw new RuleError(`不存在牌 ${cardId}`);
    const next = this.zone(destination), previous = this.zone(card.location);
    if (destination.zone === "status") {
      if (!card.attachment || !this.canAttach(card, destination.playerId, card.attachment.effectId)) throw new RuleError("状态区需要合法且不重复的挂载效果");
    }
    const from = card.location;
    const publicTraits = !covered && from.zone === "hand" && (destination.zone === "field" || (destination.zone === "discard" && visibility === "public"))
      ? card.getTraits({ game: this, playerId: from.playerId, purpose: "public-observation" }) : null;
    const index = previous.indexOf(card);
    if (index < 0) throw new RuleError("牌位置与区域不一致");
    previous.splice(index, 1); next.push(card);
    this.publicHistory.move(from, destination, publicTraits);
    card.setLocation(destination);
    card.discardVisibility = destination.zone === "discard" ? visibility : null;
    if (destination.zone !== "status") card.attachment = null;
    if (from.zone === "status" || destination.zone === "status") this.triggers.registerCard(card);
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
    try {
      const detail = this.describeCards([card], sourcePlayerId ?? playerId);
      const moved = this.moveCard(card.id, { zone: "status", playerId });
      this.log.push(`${sourcePlayerId == null ? "" : this.actorLabel(sourcePlayerId) + "将"}${effectLabel(this, effectId)}${detail}附加到${this.actorLabel(playerId)}，作为${card.category === "basic" ? "基础效果" : "专属牌"}`);
      return moved;
    }
    catch (error) { card.attachment = previous; throw error; }
  }

  removeEffect(cardId, destination = { zone: "discard" }) {
    const card = this.cards.get(cardId);
    if (card?.location.zone !== "status") throw new RuleError("这张牌没有挂载效果");
    const owner = card.location.playerId, name = effectLabel(this, card.attachment.effectId);
    const detail = this.describeCards([card], owner);
    const moved = this.moveCard(cardId, destination);
    this.log.push(`${this.actorLabel(owner)}的${name}${detail}被移除，${destination.zone === "hand" ? "收入" + this.actorLabel(destination.playerId) + "手牌" : destination.zone === "outside" ? "返回场外" : "进入弃牌堆"}`);
    return moved;
  }

  registerSkill(id, definition) {
    if (this.skillDefinitions.has(id)) throw new RuleError(`技能已注册 ${id}`);
    this.skillDefinitions.set(id, { priority: 0, ...definition, id });
    for (const player of this.players) {
      this.triggers.registerHero(player);
      for (const card of player.statuses) this.triggers.registerCard(card);
    }
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
    if (timing !== Timing.CARD_EXPOSED) yield* this.flushRuleEvents(options);
    yield* this.present();
    this.timeline.push({ timing, playerId: context.playerId ?? context.targetId, cardId: context.card?.id ?? null, point: context.point ?? null });
    if (timing === Timing.TURN_START) this.publicHistory.append({ type: "turn" });
    if (timing === Timing.ATTACK_HIT) this.publicHistory.attack(context, this);
    const entries = this.triggers.get(timing, context);
    for (const entry of entries) {
      if (!entry.active) continue;
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

  draw(id, count, { overflow = "first", moraleLoss = true, cause = { type: "directDraw" } } = {}) {
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
    if (count > 0) this.log.push(`${this.actorLabel(id)}摸${cards.length}张牌${this.describeCards(cards.map(card => this.cards.get(card.id)), id, { hidden: true })}${cause.type === "damage" ? "（伤害摸牌）" : "（非伤害摸牌）"}${cards.length < count ? `；牌库不足，原计划${count}张` : ""}`);
    if (cards.length) this.recordPresentation("draw", { playerId: id, cards });
    const excess = Math.max(0, player.hand.length - player.handLimit);
    if (excess) {
      const policy = typeof overflow === "function" ? overflow(player, excess) : overflow;
      if (policy === "defer") {
        player.pendingOverflow = { moraleLoss, cause };
      } else {
        let indexes = policy;
        if (policy === "first") indexes = Array.from({ length: excess }, (_, index) => index);
        if (policy === "ai") indexes = chooseAiDiscard(this, id, excess);
        if (policy === "random") indexes = this.randomIndexes(player.hand.length, excess);
        this.resolveOverflow(id, indexes, { moraleLoss, cause });
      }
    }
  }

  randomIndexes(length, count) {
    const available = Array.from({ length }, (_, index) => index);
    const selected = [];
    while (selected.length < count) selected.push(available.splice(Math.floor(this.random() * available.length), 1)[0]);
    return selected;
  }

  resolveOverflow(id, indexes, options = {}) {
    const events = [];
    const result = resolveSync(this.overflowSteps(id, indexes, { ...this.player(id).pendingOverflow, ...options }), request => this.automaticDecision(request, options), batch => { events.push(...batch); });
    this.presentationEvents.unshift(...events); return result;
  }
  resolveOverflowWithDecisions(id, indexes, options = {}) {
    return resolveAsync(this.overflowSteps(id, indexes, { ...this.player(id).pendingOverflow, ...options }), request => this.interactiveDecision(request, options), options.onPresentation ?? this.onPresentation);
  }
  *overflowSteps(id, indexes, { moraleLoss = true, cause = { type: "directDraw" }, ...options } = {}) {
    const player = this.player(id);
    const excess = Math.max(0, player.hand.length - player.handLimit);
    if (!excess) { delete player.pendingOverflow; return []; }
    if (!Array.isArray(indexes) || indexes.length !== excess || new Set(indexes).size !== excess || indexes.some(index => !Number.isInteger(index) || index < 0 || index >= player.hand.length)) throw new RuleError(`爆牌必须选择${excess}张不同的合法手牌`);
    const discardedDetails = this.describeCards(indexes.map(index => player.hand[index]), id, { hidden: true });
    const discarded = [...indexes].sort((a, b) => b - a).map(index => this.discardCard(player, index, { animate: false, visibility: "hidden" }));
    this.recordPresentation("discard", { playerId: id, cards: discarded.map(card => card.toJSON()), visibility: "hidden", reason: "overflow" });
    delete player.pendingOverflow;
    const context = { playerId: id, team: player.team, amount: moraleLoss ? -excess : 0, cause };
    if (context.amount) { yield* this.trigger(Timing.MORALE_BEFORE, context, options); context.amount = Math.min(0, context.amount); this.changeMorale(player.team, context.amount); }
    this.log.push(`${player.name}爆牌，暗弃${discarded.length}张手牌${discardedDetails}；己方士气-${-context.amount}`);
    yield* this.present(); return discarded;
  }

  discardCard(player, index, options = {}) {
    if (!Number.isInteger(index) || index < 0 || index >= player.hand.length) throw new RuleError("无效的手牌编号");
    this.queueExposure(player.id, [player.hand[index]], { reason: "discard", visibility: options.visibility ?? "public", covered: options.covered ?? false });
    return this.moveCard(player.hand[index].id, { zone: "discard" }, options);
  }

  playCard(player, index, options = {}) {
    if (!Number.isInteger(index) || !player.hand[index]) throw new RuleError("无效的手牌编号");
    this.log.push(`${this.actorLabel(player.id)}出牌${this.describeCards([player.hand[index]], player.id)}`);
    this.queueExposure(player.id, [player.hand[index]], { reason: "play" });
    const card = this.moveCard(player.hand[index].id, { zone: "field" }, { reason: "play", targetId: options.targetId });
    options.resolutionCards?.push(card.id);
    return card;
  }

  changeMorale(team, amount) {
    const before = this.teams[team].morale;
    this.teams[team].morale = Math.min(15, before + amount);
    this.log.push(`${team === "red" ? "红" : "蓝"}方士气${this.teams[team].morale - before >= 0 ? "+" : ""}${this.teams[team].morale - before}（${before}→${this.teams[team].morale}）`);
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
    if (this.turn.state?.playerId === actorId && this.turn.state.completed && !this.turn.canUse(card.type, card)) return [];
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
    if (this.turn.state?.playerId === actorId && this.turn.state.completed) return false;
    const player = this.player(actorId);
    return player.handLimit - player.hand.length <= 2 &&
      this.unusableCards(actorId).length === player.hand.length && !player.hero.canActWithSkills && !this.legalSkillActions(actorId).length;
  }

  canDrawSpecial(actorId) {
    return (!this.turn.state || this.turn.state.playerId !== actorId || this.turn.canUse("special")) && this.player(actorId).hand.length <= 3;
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

  purchase(actorId, options = {}) { return resolveSync(this.purchaseSteps(actorId, options), request => this.automaticDecision(request, options)); }
  synthesize(actorId, gemCount, options = {}) { return resolveSync(this.synthesizeSteps(actorId, gemCount, options), request => this.automaticDecision(request, options)); }
  refine(actorId, stones, options = {}) { return resolveSync(this.refineSteps(actorId, stones, options), request => this.automaticDecision(request, options)); }
  refreshUnableHand(actorId, options = {}) { return resolveSync(this.refreshUnableHandSteps(actorId, options), request => this.automaticDecision(request, options)); }
  skipExtraActions(playerId) {
    if (this.turn.state?.playerId !== playerId || !this.turn.state.completed) throw new RuleError("当前不能结束额外行动");
    this.turn.state.pendingActions = [];
    this.log.push(`${this.player(playerId).name}放弃剩余额外行动`);
  }
  executeAction(actorId, action, options = {}) {
    if (action.type === "play") return this.playWithDecisions(actorId, action.index, action.targetId, options);
    let steps;
    if (action.type === "purchase") steps = this.purchaseSteps(actorId, options);
    else if (action.type === "synthesize") steps = this.synthesizeSteps(actorId, action.gemCount, options);
    else if (action.type === "refine") steps = this.refineSteps(actorId, action.stones, options);
    else if (action.type === "skill") steps = this.skillActionSteps(actorId, action, options);
    else if (action.type === "refresh") steps = this.refreshUnableHandSteps(actorId, options);
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
    yield* this.turn.endAction(options);
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
    yield* this.turn.endAction(options);
  }

  canRefine(playerId) {
    const player = this.player(playerId);
    return !this.winner && this.turn.canUse("special") && player.energy.gem + player.energy.crystal < 3 && this.stoneCounts(player.team).total > 0;
  }

  *refineSteps(actorId, { gem = 0, crystal = 0 }, options = {}) {
    if (!this.canRefine(actorId)) throw new RuleError("当前不能提炼");
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
    yield* this.turn.endAction(options);
  }

  *refreshUnableHandSteps(actorId, options = {}) {
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
    yield* this.turn.endAction(options);
  }

  queueExposure(playerId, cards, { reason = "show", visibility = "public", covered = false } = {}) {
    if (visibility !== "public" || covered || !cards.length) return;
    this.pendingRuleEvents.push({ playerId, cards: [...cards], traits: cards.map(card => card.getTraits({ game: this, playerId, purpose: "exposure" })), origin: "hand", visibility, covered, reason });
  }
  *flushRuleEvents(options = {}) {
    if (this.processingRuleEvents) return;
    this.processingRuleEvents = true;
    try { while (this.pendingRuleEvents.length && !this.winner) yield* this.trigger(Timing.CARD_EXPOSED, this.pendingRuleEvents.shift(), options); }
    finally { this.processingRuleEvents = false; }
  }
  *showCardsSteps(playerId, cards, options = {}) {
    if (cards.some(card => card.location.zone !== "hand" || card.location.playerId !== playerId)) throw new RuleError("只能展示本人手牌");
    this.log.push(`${this.player(playerId).name}展示${cards.map(cardName).join("、")}`);
    this.queueExposure(playerId, cards, options); yield* this.flushRuleEvents(options);
  }

  *choosePlayer(playerId, targets, title, metadata = {}) {
    const id = yield { type: "playerChoice", playerId, title, ...metadata, choices: targets.map(id => ({ value: id, label: `${this.player(id).name} · ${this.player(id).hero.name}` })), defaultValue: targets.includes(playerId) ? playerId : targets[0] };
    if (!targets.includes(id)) throw new RuleError("无效的目标选择"); return id;
  }
  *chooseBasicEffect(playerId, cards, title) {
    const effects = cards.filter(card => card.location.zone === "status" && card.category === "basic");
    if (!effects.length) throw new RuleError("没有基础效果可以选择");
    const id = yield { type: "effectChoice", playerId, title, choices: effects.map((card, index) => ({ value: card.id, label: `${this.player(card.location.playerId).name}：${this.effects.get(card.attachment.effectId)?.name ?? cardName(card)} · ${index + 1}${card.attachment.sourcePlayerId == null ? "" : "（来自" + this.player(card.attachment.sourcePlayerId).name + "）"}` })), defaultValue: effects[0].id };
    if (!effects.some(card => card.id === id)) throw new RuleError("无效的基础效果"); return id;
  }
  *removeBasicEffectSteps(cardId, actorId, options = {}) {
    const card = this.cards.get(cardId);
    if (card?.category !== "basic" || card.location.zone !== "status") throw new RuleError("只能移除基础效果");
    const targetId = card.location.playerId;
    this.removeEffect(cardId);
    yield* this.trigger(Timing.BASIC_EFFECT_REMOVED, { actorId, targetId, card }, options);
  }

  legalSkillActions(playerId) {
    const player = this.player(playerId);
    return player.getSkills().flatMap(({ skill }) => {
      const definition = typeof skill === "string" ? this.skillDefinitions.get(skill) : skill;
      if (!definition?.action) return [];
      const spec = definition.action(this, player);
      if (!spec || !this.turn.canUse(spec.type) || (spec.energy && !this.canPayEnergy(playerId, spec.energy))) return [];
      if (player.hand.filter(spec.cardFilter ?? (() => true)).length < (spec.cardCount ?? 0) || (spec.targets?.length ?? 0) < (spec.targetCount ?? 1)) return [];
      return [{ skillId: definition.id, name: definition.name, spec }];
    });
  }
  skillActionSpec(playerId, action) {
    const player = this.player(playerId);
    const definition = player.getSkills().map(({ skill }) => typeof skill === "string" ? this.skillDefinitions.get(skill) : skill).find(skill => skill?.id === action.skillId);
    return definition?.action?.(this, player, action) ?? null;
  }
  *skillActionSteps(playerId, action, options = {}) {
    if (this.winner) throw new RuleError("游戏已经结束");
    const player = this.player(playerId);
    const entry = this.legalSkillActions(playerId).find(entry => entry.skillId === action.skillId);
    if (!entry) throw new RuleError("当前不能发动此行动技能");
    const spec = this.skillActionSpec(playerId, action);
    if (!spec) throw new RuleError("技能选项无效");
    const cards = (action.cardIds ?? []).map(id => this.cards.get(id));
    const targetIds = action.targetIds ?? [];
    if (cards.length !== (spec.cardCount ?? 0) || new Set(cards).size !== cards.length || cards.some(card => !card || card.location.zone !== "hand" || card.location.playerId !== playerId || !(spec.cardFilter?.(card) ?? true))) throw new RuleError("技能手牌费用无效");
    if (!(spec.targetCounts ?? [spec.targetCount ?? 1]).includes(targetIds.length) || new Set(targetIds).size !== targetIds.length || targetIds.some(id => !spec.targets.includes(id))) throw new RuleError("技能目标无效");
    const definition = player.getSkills().map(({ skill }) => typeof skill === "string" ? this.skillDefinitions.get(skill) : skill).find(skill => skill.id === action.skillId);
    const validateAction = () => {
      const current = this.skillActionSpec(playerId, action);
      if (!current || (current.energy && !this.canPayEnergy(playerId, current.energy))) throw new RuleError("启动后此技能费用或选项已不可用，请重新选择行动");
    };
    yield* this.turn.beginAction(playerId, spec.type, null, { ...options, validateAction, actionEnergyCost: spec.energy ? 1 : 0, actionHealingCost: spec.healingCost ?? 0 });
    validateAction();
    this.recordPresentation("skill", { playerId, skillId: definition.id, label: definition.name });
    this.logSkill(playerId, definition.id, `${targetIds.length ? "目标：" + targetIds.map(id => this.actorLabel(id)).join("、") : "作用于自身"}${action.mode ? `；${spec.modes?.find(mode => mode.value === action.mode)?.label ?? action.mode}` : ""}`);
    const resolutionCards = [];
    yield* definition.resolveAction({ game: this, player, cards, targetIds, action, options: { ...options, resolutionCards } });
    for (const id of resolutionCards) if (this.cards.get(id).location.zone === "field") this.moveCard(id, { zone: "discard" }, { animate: false });
    if (resolutionCards.length) this.recordPresentation("cleanup", { cardIds: resolutionCards, visibility: "public" });
    if (player.pendingOverflow) yield { type: "overflow", player };
    yield* this.present();
    yield* this.turn.endAction(options);
  }

  *chooseHandCards(playerId, count, predicate = () => true, { title = "选择手牌", optional = false, purpose = "discard", recipientId = null, skillId = null, context = null } = {}) {
    const player = this.player(playerId);
    const valid = player.hand.flatMap((card, index) => predicate(card) ? [index] : []);
    if (valid.length < count) throw new RuleError("没有足够的合法手牌");
    const indexes = yield { type: "cardChoice", playerId, count, valid, purpose, recipientId, skillId, context, cards: player.hand, title, optional, defaultValue: optional ? null : valid.slice(0, count) };
    if (optional && indexes == null) return null;
    if (!Array.isArray(indexes) || indexes.length !== count || new Set(indexes).size !== count || indexes.some(index => !valid.includes(index))) throw new RuleError("无效的手牌选择");
    return indexes.map(index => player.hand[index]);
  }
  discardCards(playerId, cards, { visibility = "public", reason = "skillCost", covered = false } = {}) {
    const player = this.player(playerId);
    if (cards.some(card => card.location.zone !== "hand" || card.location.playerId !== playerId)) throw new RuleError("弃牌必须来自本人手牌");
    const detail = this.describeCards(cards, playerId, { hidden: visibility === "hidden" || covered });
    this.queueExposure(playerId, cards, { visibility, reason, covered });
    for (const card of cards) this.moveCard(card.id, { zone: "discard" }, { animate: false, visibility, covered });
    this.recordPresentation("discard", { playerId, cards: cards.map(card => card.toJSON()), visibility, reason });
    this.log.push(`${this.actorLabel(playerId)}${visibility === "hidden" ? "暗弃" : covered ? "盖牌明弃" : "明弃"}${cards.length}张手牌${detail}`);
    if (player.hand.length <= player.handLimit) delete player.pendingOverflow;
  }

  *offerSkill(playerId, skillId, title, context = {}) {
    const value = yield { type: "skillChoice", playerId, skillId, title, context, energy: { ...this.player(playerId).energy }, reservedEnergy: this.turn.state?.reservedEnergy ?? 0, reservedHealing: this.turn.state?.reservedHealing ?? 0,
      choices: [{ value: true, label: "发动" }, { value: false, label: "不发动" }], defaultValue: false };
    if (value) { this.logSkill(playerId, skillId, context.targetId != null ? `目标：${this.actorLabel(context.targetId)}` : ""); this.recordPresentation("skill", { playerId, skillId, label: title }); }
    return value === true;
  }

  canPayEnergy(playerId, kind, count = 1) {
    const energy = this.player(playerId).energy;
    return (kind === "gem" ? energy.gem : energy.gem + energy.crystal) >= count;
  }
  payEnergy(playerId, kind, count = 1) {
    if (!Number.isInteger(count) || count < 0 || !this.canPayEnergy(playerId, kind, count)) throw new RuleError("个人能量不足");
    const energy = this.player(playerId).energy;
    const crystals = kind === "gem" ? 0 : Math.min(count, energy.crystal);
    energy.crystal -= crystals; energy.gem -= count - crystals;
    this.log.push(`${this.actorLabel(playerId)}消耗${count - crystals}宝石、${crystals}水晶；剩余${energy.gem}宝石、${energy.crystal}水晶`);
    this.recordPresentation("energy", { playerId, gem: -(count - crystals), crystal: -crystals });
  }
  *paySkillEnergy(playerId, kind, count = 1) {
    if (!this.canPayEnergy(playerId, kind, count)) throw new RuleError("个人能量不足");
    if (kind === "gem") { this.payEnergy(playerId, kind, count); return; }
    const energy = this.player(playerId).energy;
    const choices = Array.from({ length: count + 1 }, (_, gem) => ({ value: { gem, crystal: count - gem }, label: `${gem}宝石 ${count - gem}水晶` }))
      .filter(choice => choice.value.gem <= energy.gem && choice.value.crystal <= energy.crystal);
    const selected = choices.length === 1 ? choices[0].value : yield { type: "energyChoice", playerId, title: "选择个人能量支付技能费用", choices, defaultValue: choices[0].value };
    if (!choices.some(choice => choice.value.gem === selected?.gem && choice.value.crystal === selected?.crystal)) throw new RuleError("无效的能量支付方式");
    energy.gem -= selected.gem; energy.crystal -= selected.crystal;
    this.log.push(`${this.actorLabel(playerId)}消耗${selected.gem}宝石、${selected.crystal}水晶；剩余${energy.gem}宝石、${energy.crystal}水晶`);
    this.recordPresentation("energy", { playerId, gem: -selected.gem, crystal: -selected.crystal });
  }
  getHealingLimit(playerId) {
    return this.player(playerId).getSkills().reduce((limit, { skill }) => (typeof skill === "string" ? this.skillDefinitions.get(skill) : skill)?.modifyHealingLimit?.(limit, { game: this, playerId }) ?? limit, 2);
  }
  changeHealing(playerId, amount, { limit = this.getHealingLimit(playerId) } = {}) {
    const player = this.player(playerId);
    const actual = amount > 0 ? Math.max(0, Math.min(amount, limit - player.healing)) : -Math.min(-amount, player.healing);
    const before = player.healing;
    player.healing += actual;
    if (amount) this.log.push(`${this.actorLabel(playerId)}治疗${actual >= 0 ? "+" : ""}${actual}（${before}→${player.healing}${amount > actual && amount > 0 ? `；上限${limit}，未增加${amount - actual}` : ""}）`);
    if (actual) this.recordPresentation("healing", { playerId, amount: actual });
    return actual;
  }

  *damageSteps(targetId, amount, options = {}) {
    const { sourceId = null, damageType = DamageType.ATTACK, overflow = "first", useHealing, attackContext } = options;
    const target = this.player(targetId);
    if (!Object.values(DamageType).includes(damageType)) throw new RuleError("无效的伤害类别");
    const context = attackContext ?? { targetId, sourceId, amount, damageType };
    Object.assign(context, { actorId: sourceId, targetId, sourceId, amount, damageType, point: 3 });
    yield* this.trigger(Timing.DAMAGE_BEFORE, context, options);
    context.point = 4; context.healingLimit = Math.min(Math.max(0, context.amount), target.healing);
    yield* this.trigger(Timing.HEALING_BEFORE, context, options);
    const requested = useHealing ?? (context.healingLimit ? yield { type: "healing", playerId: targetId, context: { amount: context.amount, damageType }, title: "使用治疗抵挡伤害", choices: Array.from({ length: context.healingLimit + 1 }, (_, value) => ({ value, label: `使用${value}治疗` })), defaultValue: 0 } : 0);
    if (!Number.isInteger(requested) || requested < 0 || requested > context.healingLimit) throw new RuleError("无效的治疗使用数量");
    if (requested) this.log.push(`${this.actorLabel(targetId)}使用${requested}治疗抵挡${requested}点${context.damageType === "attack" ? "攻击" : "法术"}伤害`);
    this.changeHealing(targetId, -requested);
    context.actual = Math.max(0, context.amount - requested);
    context.point = 5;
    yield* this.trigger(Timing.DAMAGE_ACTUAL_BEFORE, context, options);
    context.actual = Math.max(0, context.actual);
    context.point = 6;
    yield* this.trigger(Timing.DAMAGE_ACTUAL, context, options);
    this.recordPresentation("damage", { playerId: targetId, sourceId, amount: context.actual, damageType: context.damageType });
    yield* this.present();
    if (context.actual) this.draw(targetId, context.actual, { overflow: "defer", cause: { type: "damage", sourceId, damageType: context.damageType } });
    yield* this.present();
    if (target.pendingOverflow) {
      const excess = target.hand.length - target.handLimit;
      const policy = typeof overflow === "function" ? overflow(target, excess) : overflow;
      if (policy === "defer") yield { type: "overflow", player: target };
      else {
        const indexes = policy === "ai" ? chooseAiDiscard(this, targetId, excess) : policy === "random" ? this.randomIndexes(target.hand.length, excess) : policy === "first" ? Array.from({ length: excess }, (_, index) => index) : policy;
        yield* this.overflowSteps(targetId, indexes, { ...options, ...target.pendingOverflow });
      }
    }
    this.log.push(`${target.name}承受${context.actual}点${context.damageType === DamageType.SPELL ? "法术" : "攻击"}伤害`);
    yield* this.trigger(Timing.DAMAGE_AFTER, context, options);
    return context.actual;
  }
  damage(targetId, amount, options = {}) { return resolveSync(this.damageSteps(targetId, amount, options), request => this.automaticDecision(request, options)); }

  canRespond(attack, response, context = {}) {
    return attack.canRespond(response, { game: this, ...context });
  }

  *actionSteps(actorId, handIndex, targetId, options = {}) {
    if (this.winner) throw new RuleError("游戏已经结束");
    const actor = this.player(actorId), card = actor.hand[handIndex];
    if (!card || !this.legalTargets(actorId, card).includes(targetId)) throw new RuleError("这张牌目前不能指定该目标");
    yield* this.turn.beginAction(actorId, card.type, card, options);
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
    yield* this.turn.endAction(options);
  }
  play(actorId, handIndex, targetId, options = {}) {
    return resolveSync(this.actionSteps(actorId, handIndex, targetId, options), request => this.automaticDecision(request, options));
  }
  playWithDecisions(actorId, handIndex, targetId, options = {}) {
    return resolveAsync(this.actionSteps(actorId, handIndex, targetId, options), request => this.interactiveDecision(request, options), options.onPresentation ?? this.onPresentation);
  }

  automaticDecision(request, options = {}) {
    if (request.type !== "response") {
      const chosen = options.choose?.(request);
      if (chosen !== undefined) return chosen;
      return options.skillChoices?.[request.skillId] ?? (options.ai ? chooseAiRuleDecision(request, this) : request.defaultValue) ?? null;
    }
    const { target, valid } = request;
    const configured = options.responses?.[target.id];
    let decision = typeof configured === "number" ? { index: configured } : configured;
    if (!decision && !request.isCounter && options.responseIndex != null) decision = { index: options.responseIndex, targetId: options.responseTargetId };
    const automatic = typeof options.autoRespond === "function" ? options.autoRespond(target.id) : options.autoRespond;
    if (!decision && automatic && valid.length) {
      decision = chooseAiResponse(this, request);
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
    if (request.type === "response") {
      const chosen = options.chooseResponse?.(request);
      return chosen !== undefined ? chosen : this.automaticDecision(request, options);
    }
    if (request.type === "target") return options.chooseTarget?.(request);
    if (request.type === "overflow") return options.resolveOverflow?.(request);
    const chosen = options.choose?.(request);
    if (chosen !== undefined) return chosen;
    const fallback = this.onDecision?.(request);
    return fallback !== undefined ? fallback : this.automaticDecision(request, options);
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
    return resolveSync(this.turn.start(playerId, options), request => request.type === "weakness" ? options.weakness ?? "skip" : this.automaticDecision(request, options));
  }

  async beginTurn(playerId, decisions = {}, options = {}) {
    return resolveAsync(this.turn.start(playerId, options), request => {
      if (request.type === "weakness") return decisions.chooseWeakness?.(request) ?? "skip";
      if (request.type === "overflow") return decisions.resolveOverflow?.(request);
      return decisions.choose?.(request) ?? this.onDecision?.(request) ?? this.automaticDecision(request, options);
    }, decisions.onPresentation ?? this.onPresentation);
  }
  beginAction(playerId, actionType) { return resolveSync(this.turn.beginAction(playerId, actionType), () => null); }
  endAction(options = {}) { return resolveSync(this.turn.endAction(options), request => this.automaticDecision(request, options)); }
  endTurn(options = {}) { return resolveSync(this.turn.end(options), request => this.automaticDecision(request, options)); }
  endTurnWithDecisions(options = {}) { return resolveAsync(this.turn.end(options), request => this.interactiveDecision(request, options), options.onPresentation ?? this.onPresentation); }
}
