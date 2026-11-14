import { saveInabilityArchive } from './inability-archive.js';
import { installGameRecorder } from './game-recorder.js';
import { controlledSeats, revealsHiddenCards } from '../src/play-mode.js';
import { playableCards } from "../src/playable-cards.js";
import { resolveAsync } from "/src/resolution/decisions.js";
import { cardSets, targetCounts } from "/src/card-sets.js";
import { modelEnabled, installModel, modelChoice } from "/web/model-ai.js";
import { decisionPlayer } from "/training/candidates.mjs";
import { PlaybackGate, createModeControls } from "/web/play-mode.js";
import { chooseRoster, SEAT_LABELS } from "/web/roster-picker.js";
import { skipDeveloperAction } from "/web/developer-mode.js";
import { getAvailableHeroes } from "/src/hero.js";
import { CARD_NAMES, ELEMENT_NAMES, FATE_NAMES } from "/src/cards.js";
import { Game } from "/src/engine.js";
import { overflowChoices } from "/src/inability.js";
import { chooseAiAction, chooseAiResponse, chooseAiRuleDecision, chooseAiDiscard } from "/src/ai.js";
import { compareHandCards } from "/src/cards.js";

import { renderTeams, renderPlayers as paintPlayers, renderHand as paintHand, resizeStage, layoutHand, cardContents, cardLabel } from "/web/render.js";
import { AnimationDirector, presentationView, preloadAnimationAssets } from "/web/animation.js";
import { Session, Cancelled } from "/web/session.js";

let humanId = 0;
const $ = selector => document.querySelector(selector);
const elements = {
  players: $("#players"), hand: $("#hand"), log: $("#log"), turn: $("#turn-name"), hint: $("#hint"),
  red: $("#red-team"), blue: $("#blue-team"), deck: $("#deck-count"), discard: $("#discard-count"),
  handCount: $("#hand-count"), buy: $("#buy"), synth: $("#synth"), refine: $("#refine"),
  modal: $("#modal"), modalTitle: $("#modal-title"), modalBody: $("#modal-body"), modalActions: $("#modal-actions"), toast: $("#toast"),
};

// Original nova places dialog content and its control bar separately in the arena.
$("#arena").append(elements.modal);
elements.modal.append(elements.modalActions);

let playMode = "normal";
let modeReady = false;
let playback = new PlaybackGate();
let controlledIds = new Set([0]);
const isHuman = id => controlledIds.has(id);
const modeControls = createModeControls($("#window"), command => launch(() => modeCommand(command)));
let game;
let gameRecorder = null;
let director = null;
// Rendering owns a detached playback frame; the live game may be several events ahead.
let shownGame = null;
let presenting = false;
let animationMode = new URLSearchParams(location.search).get("motion") === "off" ? "off" : "normal";
let acceptingAction = false;
let selectedCard = null;
let actionLog = [];
let session = new Session();
let busy = false;
let targetChoice = null;
let pendingChoice = null;
let handChoice = null;
let coveredSelection = null;
let paused = false;
let presentationTail = Promise.resolve();
let presentationError = null;
let presentationPending = 0;
let manualPause = false;
let logPause = false;
function enqueuePresentation(task) {
  const active = session;
  presentationPending++;
  presenting = true;
  presentationTail = presentationTail.then(async () => {
    active.assert();
    await playback.wait(active);
    await task();
  }).catch(error => {
    if (session === active) presentationError = error;
  }).finally(() => {
    if (session === active) {
      presentationPending--;
      presenting = presentationPending > 0;
      render();
    }
  });
  return presentationTail;
}
async function awaitPresentation() {
  const active = session;
  let tail;
  do {
    tail = presentationTail;
    await tail;
    active.assert();
    await playback.wait(active);
  } while (tail !== presentationTail);
  if (presentationError) throw presentationError;
  shownGame = presentationView(game.presentationSnapshot(), game);
  presenting = false;
  render();
}
function updatePause() {
  playback.setPaused(manualPause || logPause || document.hidden);
  director?.pause(playback.paused);
  const button = document.querySelector('#pause-playback');
  if (button) button.textContent = manualPause ? '继续' : '暂停';
  if (shownGame) render();
}
let resumeTurn = null;
let seed;
let sceneId = null;
let events = [];
let keyboardMode = false;
document.addEventListener("keydown", () => { keyboardMode = true; });
document.addEventListener("pointerdown", () => { keyboardMode = false; });
const isDev = location.pathname === "/web/dev.html";
const overflowPolicy = player => modelEnabled || isHuman(player.id) ? "defer" : "ai";

function launch(task) {
  void Promise.resolve().then(task).catch(error => {
    if (!(error instanceof Cancelled)) { console.error(error); notify(error.message); }
  });
}

function configureDecisions() {
  game.onDecision = chooseRuleDecision;
  if (playMode === "developer") {
    // Every yielded decision, including nested damage and responses, belongs to a human.
    game.interactiveDecision = request => chooseRuleDecision(request);
    game.automaticDecision = () => { throw new Error("开发者模式禁止AI代选"); };
  }
}

function newGame(nextGame = null, nextSeed = Date.now(), id = null) {
  session.cancel();
  gameRecorder = null;
  const recordFlag = document.querySelector('#game-record-status');
  if (recordFlag) recordFlag.textContent = isDev ? '本模式不记录' : '正常对局自动记录';
  director?.dispose();
  session = new Session();
  playback = new PlaybackGate();
  playback.setPaused(document.hidden);
  presentationTail = Promise.resolve(); presentationError = null; presentationPending = 0;
  manualPause = false; logPause = false;
  playMode = "normal"; humanId = 0; modeReady = !!nextGame;
  controlledIds = new Set([0]);
  $("#window").dataset.playMode = playMode;
  shownGame = null; presenting = false;
  seed = nextSeed;
  sceneId = id;
  game = nextGame || new Game({ seed });
  shownGame = presentationView(game.presentationSnapshot(), game);
  game.onInabilityArchive = saveInabilityArchive;
  configureDecisions();
  if (playMode !== "developer") installModel(game, isHuman, session, async () => session.assert());
  acceptingAction = false;
  busy = false;
  selectedCard = null;
  targetChoice = null;
  pendingChoice = null;
  handChoice = null;
  coveredSelection = null;
  finishAction = null;
  resumeTurn = null;
  actionLog = [];
  events = [];
  elements.log.replaceChildren();
  closeModal();
  clearTimeout(notify.timer);
  elements.toast.classList.remove("show");
  elements.hint.textContent = "准备行动";
  render();
  const active = session;
  director = new AnimationDirector($("#arena"), active, { mode: animationMode, perspective: () => humanId });
  const currentDirector = director;
  presenting = true; render();
  const playBatch = async batch => {
    active.assert(); await playback.wait(active); presenting = true; render();
    try {
      for (const event of batch) {
        await playback.wait(active);
        const playerName = event.playerId != null ? event.view.players[event.playerId].name : "";
        if (event.type === "move" && event.reason === "play") elements.hint.textContent = `${event.view.players[event.from.playerId].name}使用【${CARD_NAMES[event.card.name]}】`;
        if (event.type === "draw") elements.hint.textContent = `${playerName}摸${event.cards.length}张牌`;
        if (event.type === "relay") elements.hint.textContent = `${event.view.players[event.sourceId].name}向${playerName}传递【魔弹】`;
        if (event.type === "damage") elements.hint.textContent = `${playerName}承受${event.amount}点${event.damageType === "spell" ? "法术" : "攻击"}伤害`;
        if (event.type === "miss") elements.hint.textContent = `${playerName}：未命中`;
        if (currentDirector.instant && ["damage", "miss", "winner"].includes(event.type)) {
          const name = playerName;
          notify(event.type === "damage" ? `${name}承受${event.amount}点${event.damageType === "spell" ? "法术" : "攻击"}伤害` : event.type === "miss" ? `${name}：未命中` : `${event.team === "red" ? "红方" : "蓝方"}获胜`);
        }
        await currentDirector.show(event, snapshot => { active.assert(); shownGame = presentationView(snapshot, game); render(); });
        await playback.wait(active);
      }
    } finally { if (session === active) { presenting = presentationPending > 0; render(); } }
  };
  const onPresentation = batch => {
    enqueuePresentation(() => playBatch(batch));
    // Bound spectator look-ahead while keeping human decision latency independent.
    if (presentationPending >= 32) return presentationTail;
  };
  game.enablePresentation(onPresentation);
  launch(async () => {
    active.assert();
    if (!nextGame) {
      playMode = await choose("选择游玩模式", [{ value: "normal", label: "正常游玩" }, { value: "team", label: "多控模式（一人控制一队）" }, { value: "test", label: "测试游玩" }, { value: "spectate", label: "观战游玩" }, { value: "developer", label: "开发者模式" }]);
      active.assert();
      $("#window").dataset.playMode = playMode;
      const heroIds = await chooseRoster(active, getAvailableHeroes(), elements, openModal, closeModal, { chooseSeat: ["normal", "team"].includes(playMode), teamControl: playMode === "team", onSeat: seat => { humanId = seat; } });
      active.assert();
      game = new Game({ seed, heroIds, revealHiddenLogs: revealsHiddenCards(playMode) }).setup();
      controlledIds = new Set(controlledSeats(playMode, humanId, game.players.map(p => p.team)));
      game.onInabilityArchive = saveInabilityArchive;
      configureDecisions();
      if (playMode !== "developer") installModel(game, isHuman, session, async () => session.assert());
      game.enablePresentation(onPresentation);
      gameRecorder = await installGameRecorder(game, { mode: playMode, humanSeat: humanId, humanSeats: [...controlledIds], session: active, developerScene: isDev });
      active.assert();
      modeReady = true;
      for (const player of game.players) {
        game.recordPresentation("draw", { playerId: player.id, cards: player.hand.map(card => card.toJSON()) });
        const view = game.presentationEvents.at(-1).view;
        for (const later of view.players) if (later.id > player.id) later.hand = [];
        view.deckCount = game.cards.size - view.players.reduce((total, member) => total + member.hand.length, 0);
      }
      // Start from empty hands visually; actual setup is already complete.
      const snapshot = game.presentationEvents[0]?.view;
      if (snapshot) {
        const empty = structuredClone(snapshot);
        for (const player of empty.players) player.hand = [];
        empty.deckCount = game.cards.size;
        shownGame = presentationView(empty, game); render();
        await preloadAnimationAssets(); await document.fonts.ready; active.assert();
        await game.onPresentation(game.presentationEvents.splice(0));
        await awaitPresentation();
      }
    }
    await preloadAnimationAssets(); await document.fonts.ready; active.assert();
    presenting = false; render();
    await runTurns(active);
  });
}

function render() {
  const view = shownGame;
  modeControls.update(playMode, { ready: modeReady, editable: canEditTest(), hasCards: view.player(humanId).hand.length > 0, paused: playback.paused, controlled: `${view.player(humanId).hero.name}（${SEAT_LABELS[humanId]}）`, morale: { red: view.teams.red.morale, blue: view.teams.blue.morale } });
  renderTeams(view, { red: elements.red, blue: elements.blue }, humanId);
  elements.deck.textContent = view.deck.length;
  elements.discard.textContent = view.discard.length;
  elements.turn.textContent = view.player(view.current).name;
  elements.handCount.textContent = `${view.player(humanId).hand.length} / ${view.player(humanId).handLimit}`;
  renderPlayers(view);
  paintHand(view, elements.hand, humanId, {
    acceptingAction: !presenting && (acceptingAction || !!handChoice), selectedCard, locked: presenting || (busy && !targetChoice && !handChoice), handChoice, restrictToLegal: game.turn.hasExtraActions(),
    onSelect: index => handChoice ? handChoice.select(index) : launch(() => selectCard(index)),
  });
  const player = game.player(humanId), stones = game.stoneCounts(player.team);
  $("#sort-hand").disabled = playMode === "spectate" || presenting || busy || !!targetChoice || !!pendingChoice;
  const locked = presenting || !acceptingAction || busy || !!targetChoice;
  endExtra.hidden = !game.turn.hasExtraActions(); endExtra.disabled = locked;
  activateTurn.hidden = !game.turn.state?.activationDeclined || !game.canActivate(humanId) || !game.activationChoices(humanId).length || !!targetChoice; activateTurn.disabled = locked;
  refreshHand.hidden = !game.canRefreshUnableHand(humanId); refreshHand.disabled = locked;
  elements.buy.disabled = locked || !game.canDrawSpecial(humanId);
  elements.synth.disabled = locked || !game.canDrawSpecial(humanId) || stones.total < 3;
  elements.refine.disabled = locked || !game.canRefine(humanId);
  elements.buy.hidden = !game.canDrawSpecial(humanId) || !!targetChoice;
  elements.synth.hidden = !game.canDrawSpecial(humanId) || stones.total < 3 || !!targetChoice;
  renderSkillControls(locked);
  elements.refine.hidden = !game.canRefine(humanId) || !!targetChoice;
  $("#cancel-target").hidden = !targetChoice;
  $("#control").hidden = playMode === "spectate" || !!pendingChoice;
  $(".center-hint").hidden = !!pendingChoice && !["hand", "target"].includes(pendingChoice.type);
}

function renderPlayers(view = shownGame) {
  paintPlayers(view, elements.players, humanId, presenting ? null : targetChoice?.targets, modeReady && revealsHiddenCards(playMode));
  for (const node of elements.players.children) node.onclick = null;
  if (targetChoice && !presenting) {
    const choice = targetChoice;
    for (const node of elements.players.querySelectorAll(".targetable")) {
      node.onclick = () => choice.resolve(Number(node.dataset.player));
    }
  }
}

function appendLog(message, turn = false, queued = false) {
  if (presentationPending && !queued) {
    enqueuePresentation(() => appendLog(message, turn, true));
    return;
  }
  for (const line of String(message).split("\n")) actionLog.push({ line, turn });
  actionLog = actionLog.slice(-300);
  elements.log.innerHTML = "";
  for (const item of actionLog) {
    const row = document.createElement("div");
    row.className = `log-entry${item.turn ? " turn" : ""}`;
    row.textContent = item.line;
    elements.log.append(row);
  }
  elements.log.scrollTop = elements.log.scrollHeight;
}

function flushLog() {
  if (game.log.length) appendLog(game.log.splice(0).join("\n"));
  // Capture now, then display only after the preceding animations and prompts.
  const view = presentationView(game.presentationSnapshot(), game);
  const display = () => { shownGame = view; render(); };
  if (presentationPending) enqueuePresentation(display);
  else display();
}

function canEditTest() {
  return modeReady && ["test", "developer"].includes(playMode) && acceptingAction && !game.winner && !busy && !presenting && !pendingChoice && !targetChoice;
}
async function modeCommand(command) {
  if (command === "pause" && modeReady) {
    manualPause = !manualPause; updatePause(); return;
  }
  if (!canEditTest()) return;
  const active = session, previousHint = elements.hint.textContent;
  busy = true; render();
  try {
    if (command === "next-turn") {
      if (playMode !== "developer") return;
      skipDeveloperAction(game, playMode);
      acceptingAction = false; flushLog();
      return;
    }
    if (command === "draw") {
      await resolveAsync(game.drawSteps(humanId, 1, { overflow: overflowPolicy }),
        request => game.interactiveDecision(request, { resolveOverflow: resolveHumanOverflow }), game.onPresentation);
    } else if (command === "discard") {
      const player = game.player(humanId);
      if (!player.hand.length) return;
      const indexes = await chooseHand("弃一张牌", player.hand, { count: 1, valid: player.hand.map((_, index) => index), cancel: true, cancelLabel: "取消" });
      active.assert();
      if (!indexes) return;
      game.discardCards(humanId, [player.hand[indexes[0]]], { visibility: "hidden", reason: "testControl" });
    } else {
      const [team, sign] = command.split("-");
      if (!["red", "blue"].includes(team) || !["plus", "minus"].includes(sign)) return;
      game.changeMorale(team, sign === "plus" ? 1 : -1);
    }
    const options = { overflow: overflowPolicy, resolveOverflow: resolveHumanOverflow, chooseResponse: chooseCombatResponse };
    await resolveAsync(game.flushRuleEvents(options), request => game.interactiveDecision(request, options), game.onPresentation);
    await game.flushPresentation(); active.assert();
    await resolveHumanOverflow(); active.assert();
    game.assertCardLocations(); flushLog();
    if (game.winner) { acceptingAction = false; finishAction?.(); }
  } finally { if (session === active) { busy = false; if (!game.winner) elements.hint.textContent = previousHint; render(); if (command === "next-turn" && playMode === "developer" && !acceptingAction) finishAction?.(); } }
}

function notify(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => elements.toast.classList.remove("show"), 2200);
}

function delay(ms) { return session.delay(ms); }

function choose(title, choices, { cancel = false, detail = "" } = {}) {
  return session.wait(resolve => {
    pendingChoice = { title, type: "choice", choices: choices.map(item => item.label) };
    const previousFocus = document.activeElement;
    elements.modalTitle.textContent = title;
    elements.modalBody.innerHTML = detail ? `<p>${detail}</p>` : "";
    elements.modalActions.innerHTML = "";
    for (const choice of choices) {
      const button = document.createElement("button");
      button.textContent = choice.label;
      button.addEventListener("click", () => { closeModal(); resolve(choice.value); });
      elements.modalActions.append(button);
    }
    if (cancel) {
      const button = document.createElement("button");
      button.className = "ghost";
      button.textContent = "取消";
      button.addEventListener("click", () => { closeModal(); resolve(null); });
      elements.modalActions.append(button);
    }
    openModal();
    if (keyboardMode) elements.modalActions.querySelector("button")?.focus();
    return () => { pendingChoice = null; closeModal(); previousFocus?.focus(); };
  });
}

function setPerspective(playerId) {
  if (humanId === playerId) return;
  humanId = playerId; selectedCard = null;
  gameRecorder?.viewed(playerId, shownGame.player(playerId).hand.map(card => card.id));
  render();
}
async function withControlledSeat(playerId, task, { presented = false } = {}) {
  if (!["developer", "team"].includes(playMode) || !isHuman(playerId)) return task();
  const active = session, previous = humanId;
  active.assert();
  // Queued cosmetic confirmations already run inside the presentation tail.
  // Waiting for that tail here would wait for this very task and deadlock.
  if (!presented) await awaitPresentation();
  active.assert();
  setPerspective(playerId);
  try { return await task(); }
  finally {
    if (session === active) setPerspective(previous);
  }
}

async function chooseRuleDecision(request) {
  // Turn-start decisions also use the loaded policy, including skills before an action.
  if (modelEnabled && playMode !== "developer" && !isHuman(decisionPlayer(request))) {
    if (request.type === "overflow") return resolveHumanOverflow(request);
    return modelChoice(game, decisionPlayer(request), request);
  }
  if (request.type === "response") return chooseCombatResponse(request);
  if (request.type === "overflow") return resolveHumanOverflow(request);
  if (request.cardSelection && isHuman(request.playerId)) {
    return withControlledSeat(request.playerId, async () => {
      if (!request.cardSelection.grouped) {
        await awaitPresentation();
        const ids = await chooseCoveredSet(request);
        return ids?.[0] ?? null;
      }
      const selected = request.context?.selectedCardIds ?? [];
      if (!selected.length) {
        await awaitPresentation();
        const ids = await chooseCoveredSet(request);
        coveredSelection = ids && { playerId: request.playerId, skillId: request.skillId, ids };
        if (!ids) return null;
      }
      const selection = coveredSelection;
      const id = selection?.ids[selected.length] ?? null;
      if (selection?.playerId !== request.playerId || selection?.skillId !== request.skillId ||
          !selected.every((value, index) => value === selection.ids[index]) ||
          !request.choices.some(choice => choice.value === id)) throw new Error("盖牌选择已失效，请重新开始对局");
      if (id === null || selected.length + 1 === request.cardSelection.max) coveredSelection = null;
      return id;
    });
  }
  if (playMode !== "developer" && isHuman(request.playerId) && !request.blockedReason && request.choices?.length === 1) {
    enqueuePresentation(async () => {
      presenting = false;
      await withControlledSeat(request.playerId, () => chooseSeatDecision(request, true), { presented: true });
    });
    return request.choices[0].value;
  }
  return withControlledSeat(request.playerId ?? request.player?.id ?? request.actor?.id, () => chooseSeatDecision(request));
}

function chooseCoveredSet(request) {
  return session.wait(resolve => {
    const selected = new Set();
    const previousFocus = document.activeElement;
    const spec = request.cardSelection;
    const legalNext = spec.legalNext ?? (ids => spec.cardIds.filter(id => !ids.includes(id)));
    pendingChoice = { title: request.title, type: "covered", min: spec.min, count: spec.max, selected: [] };
    elements.modalTitle.textContent = request.title;
    elements.modalBody.innerHTML = '<div class="choice-list"></div><p class="selection-count"></p>';
    elements.modalActions.replaceChildren();
    const confirm = document.createElement('button');
    confirm.textContent = request.optional ? '确认发动' : '确认'; confirm.disabled = true;
    const buttons = new Map();
    function update() {
      const ids = [...selected];
      const valid = ids.every((id, index) => legalNext(ids.slice(0, index)).includes(id));
      const available = legalNext(ids);
      for (const [id, button] of buttons) {
        button.classList.toggle('selected', selected.has(id));
        button.setAttribute('aria-pressed', String(selected.has(id)));
        button.disabled = !selected.has(id) && spec.max !== 1 && (selected.size >= spec.max || !available.includes(id));
        if (spec.max === 1) button.disabled = !legalNext([]).includes(id);
        button.classList.toggle('unusable', button.disabled);
      }
      pendingChoice.selected = ids;
      confirm.disabled = !valid || selected.size < spec.min || selected.size > spec.max;
      elements.modalBody.querySelector('.selection-count').textContent = `已选${selected.size}张，需选择${spec.min === spec.max ? spec.min : `${spec.min}至${spec.max}`}张`;
    }
    for (const id of spec.cardIds) {
      const card = game.cards.get(id);
      const button = document.createElement('button');
      button.className = 'card choice-card'; button.dataset.cardId = card.id;
      button.innerHTML = cardContents(card, { game, playerId: request.playerId });
      button.setAttribute('aria-label', cardLabel(card, { game, playerId: request.playerId })); button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => {
        if (selected.has(card.id)) selected.delete(card.id);
        else if (spec.max === 1) { selected.clear(); selected.add(card.id); }
        else if (selected.size < spec.max && legalNext([...selected]).includes(card.id)) selected.add(card.id);
        update();
      });
      buttons.set(card.id, button);
      elements.modalBody.firstChild.append(button);
    }
    update();
    confirm.addEventListener('click', () => { if (!confirm.disabled) resolve([...selected]); });
    elements.modalActions.append(confirm);
    if (request.optional) {
      const decline = document.createElement('button'); decline.textContent = '不发动';
      decline.addEventListener('click', () => resolve(null)); elements.modalActions.append(decline);
    }
    openModal();
    return () => { pendingChoice = null; closeModal(); previousFocus?.focus(); };
  });
}
async function chooseSeatDecision(request, presented = false) {

  const active = session;
  if (!presented && isHuman(request.playerId ?? request.player?.id)) await awaitPresentation();
  if (request.blockedReason) { notify(request.blockedReason); if (isHuman(request.playerId)) await choose(request.blockedReason, [{value:false,label:"返回"}]); return false; }
  if (request.type === "playerChoice") {
    if (!isHuman(request.playerId)) return chooseAiRuleDecision(request, game);
    const active = session;
    const previousHint = elements.hint.textContent;
    pendingChoice = { title: request.title, type: "target", valid: request.choices.map(choice => choice.value) };
    try {
      return await chooseTarget(pendingChoice.valid, request.title, { canCancel: false });
    } finally {
      if (session === active) { pendingChoice = null; elements.hint.textContent = previousHint; render(); }
    }
  }
  if (request.type === "cardChoice") {
    if (!isHuman(request.playerId)) return chooseAiRuleDecision(request, game);
    return chooseHand(request.title, game.player(humanId).hand, { count: request.count, valid: request.valid, validSets: request.validSets, cancel: request.optional, confirmLabel: request.purpose === "reserve" ? "确认" : undefined });
  }
  if (request.type === "weakness" && isHuman(request.player?.id ?? request.playerId)) return choose("【虚弱】触发", [{value:"draw",label:"摸3张牌并继续"},{value:"skip",label:"跳过本回合行动"}]);
  if (request.type === "target" && isHuman(request.actor.id)) return chooseTarget(request.targets.map(player => player.id), "选择应战目标", {canCancel:false});
  if (!request.choices) {
    if (playMode === "developer") throw new Error(`尚未接入手动决策：${request.type}`);
    return null;
  }
  if (!isHuman(request.playerId)) return chooseAiRuleDecision(request, game);
  if (request.type === "energyChoice" && request.skillId === "charge") {
    while (true) {
      const payment = await choose(request.title, request.choices);
      active.assert();
      if (!payment.gem || await choose("确定用宝石发动充能吗？", [
        {value:true,label:"确定"}, {value:false,label:"重新选择"},
      ])) { active.assert(); return payment; }
    }
  }
  return choose(request.title, request.choices);
}

function openModal() {
  elements.modal.querySelector(".dialog").hidden = false;
  elements.modal.classList.remove("hidden");
  $("#window").classList.add("choosing");
  render();
}
function closeModal() {
  if (!elements.modal.classList.contains("hidden")) director?.closeDialog(elements.modal.querySelector(".dialog"));
  elements.modal.classList.add("hidden");
  $("#window").classList.remove("choosing", "choosing-hand");
  elements.modal.querySelector(".dialog").hidden = false;
  if (game) render();
}

function chooseHand(title, cards, { count = 1, valid = cards.map((_, index) => index), cancel = false, cancelLabel = "不响应", validSets = null, canSelect = () => true, confirmLabel = null } = {}) {
  return session.wait(resolve => {
    const previousHint = elements.hint.textContent;
    const previousFocus = document.activeElement;
    const selected = new Set();
    pendingChoice = { title, type: "hand", count, valid, selected: [] };
    elements.hint.textContent = title;
    elements.modalActions.replaceChildren();
    const confirm = document.createElement("button");
    confirm.textContent = confirmLabel ?? (count === 1 ? "确定" : "确认弃置"); confirm.disabled = true;
    const available = () => valid.filter(index => selected.has(index) ||
      (canSelect([...selected, index]) && (!validSets ||
        validSets.some(set => set.includes(index) && [...selected].every(i => set.includes(i))))));
    handChoice = { valid: available(), selected, select(index) {
      if (!available().includes(index)) return;
      selected.has(index) ? selected.delete(index) : selected.add(index);
      pendingChoice.selected = [...selected];
      handChoice.valid = available(); pendingChoice.valid = handChoice.valid;
      confirm.disabled = !canSelect([...selected]) || (validSets ? !validSets.some(set => set.length === selected.size && set.every(index => selected.has(index))) : selected.size !== count);
      render();
    } };
    confirm.addEventListener("click", () => { director.captureHand(); resolve([...selected]); });
    elements.modalActions.append(confirm);
    if (cancel) {
      const button = document.createElement("button"); button.textContent = cancelLabel;
      handChoice.cancel = () => resolve(null);
      button.addEventListener("click", () => resolve(null)); elements.modalActions.append(button);
    }
    openModal();
    elements.modal.querySelector(".dialog").hidden = true;
    $("#window").classList.add("choosing-hand");
    render();
    if (keyboardMode) elements.hand.querySelector("button:enabled")?.focus();
    return () => {
      handChoice = null; pendingChoice = null; selectedCard = null;
      elements.hint.textContent = previousHint;
      closeModal(); render(); previousFocus?.focus();
    };
  });
}

async function chooseCards(title, cards, count) {
  return chooseHand(`${title}：弃${count}张牌`, cards, { count });
}

function chooseResponseTarget(title, valid, targets, kind = "attack") {
  return session.wait(resolve => {
    const previousHint = elements.hint.textContent;
    const previousFocus = document.activeElement;
    const selected = new Set();
    let picked = null;
    pendingChoice = { title, type: "hand", count: 1, valid: valid.map(item => item.index), selected: [] };
    const cancel = document.createElement("button"); cancel.textContent = "取消"; cancel.hidden = true;
    const confirm = document.createElement("button"); confirm.textContent = "确认";
    confirm.addEventListener("click", () => {
      if (picked?.card.name === "holyLight") { director.captureHand(); resolve({ index: picked.index, targetId: null }); }
    });
    function clearSelection() {
      picked = null; selected.clear(); selectedCard = null; targetChoice = null;
      pendingChoice.selected = []; cancel.hidden = true;
      elements.modalActions.replaceChildren(decline);
      elements.hint.textContent = title; render();
    }
    handChoice = { playable: true, valid: pendingChoice.valid, selected, cancel: clearSelection, select(index) {
      const next = valid.find(item => item.index === index);
      if (!next) return;
      if (picked?.index === index) { clearSelection(); return; }
      picked = next; selected.clear(); selected.add(index); selectedCard = index;
      pendingChoice.selected = [index]; cancel.hidden = false;
      targetChoice = null;
      if (next.card.name === "holyLight") {
        elements.modalActions.replaceChildren(confirm);
        elements.hint.textContent = `${title}，确认使用圣光`;
        render(); return;
      }
      elements.modalActions.replaceChildren(cancel);
      elements.hint.textContent = `${title}；选择${kind === "magic" ? "魔弹传递" : "应战攻击"}目标`;
      targetChoice = { targets, resolve(targetId) {
        if (targetId === null) { clearSelection(); return; }
        if (targets.includes(targetId)) { director.captureHand(); resolve({ index: picked.index, targetId }); }
      } };
      render();
    } };
    cancel.addEventListener("click", clearSelection);
    const decline = document.createElement("button"); decline.textContent = "不响应";
    decline.addEventListener("click", () => resolve(null));
    elements.modalActions.replaceChildren(decline);
    elements.hint.textContent = title;
    openModal(); elements.modal.querySelector(".dialog").hidden = true;
    $("#window").classList.add("choosing-hand"); render();
    if (keyboardMode) (elements.hand.querySelector("button:enabled") || decline).focus();
    return () => {
      targetChoice = null; handChoice = null; pendingChoice = null; selectedCard = null;
      elements.hint.textContent = previousHint;
      closeModal(); previousFocus?.focus();
    };
  });
}

async function resolveHumanOverflow(request) {
  if (game.winner || (playMode === "spectate" && !request)) return;
  if (request?.resolveInternally) {
    const id=request.player.id, player=game.player(id);
    if (!isHuman(id)) {
      if (modelEnabled) return modelChoice(game,id,request);
      const preferred=chooseAiDiscard(game,id,player.hand.length-player.handLimit);
      return request.validSets?.find(set=>set.length===preferred.length && set.every(i=>preferred.includes(i))) ?? request.validSets?.[0] ?? preferred;
    }
    return withControlledSeat(id,async()=>{
      await awaitPresentation();
      const choices=overflowChoices(game,id);
      return chooseHand(request.title ?? `爆牌：弃${choices.count}张牌`,player.hand,
        {...choices,...(request.validSets?{valid:request.valid,validSets:request.validSets}:{})});
    });
  }
  const ids = request?.player ? [request.player.id] : [...controlledIds];
  for (const id of ids) {
    if (!isHuman(id)) {
      if (modelEnabled && game.player(id).pendingOverflow) {
        const indexes = await modelChoice(game, id, { type: "overflow", player: game.player(id) });
        await game.resolveOverflowWithDecisions(id, indexes, { overflow: overflowPolicy, resolveOverflow: resolveHumanOverflow, chooseResponse: chooseCombatResponse });
      }
      continue;
    }
    if (game.player(id).hand.length <= game.player(id).handLimit) continue;
    await withControlledSeat(id, async () => {
      const active = session, player = game.player(id);
      if (player.hand.length <= player.handLimit) return;
      await awaitPresentation();
      const choices = overflowChoices(game, id);
      const indexes = await chooseHand(`爆牌：弃${choices.count}张牌`, player.hand, choices);
      active.assert();
      await game.resolveOverflowWithDecisions(id, indexes, { ...player.pendingOverflow, overflow: overflowPolicy, resolveOverflow: resolveHumanOverflow, chooseResponse: chooseCombatResponse });
      await game.flushPresentation(); active.assert(); flushLog();
    });
  }
}

async function selectCard(index) {
  if (!acceptingAction) return;
  if (targetChoice) {
    if (selectedCard === index) { targetChoice.resolve(null); return; }
    if (targetChoice.skillCards) {
      if (targetChoice.skillCards.length !== 1) return;
      const card = playableCards(game.player(humanId))[index];
      if (!(targetChoice.cardFilter?.(card) ?? true)) return;
      targetChoice.skillCards[0] = card.id; selectedCard = index; render(); return;
    }
    const card = playableCards(game.player(humanId))[index], targets = game.legalTargets(humanId, card);
    if (!targets.length) return;
    selectedCard = index; targetChoice.targets = targets;
    elements.hint.textContent = `为【${CARD_NAMES[card.name]}】选择目标`; render(); return;
  }
  if (busy) return;
  const card = playableCards(game.player(humanId))[index];
  const targets = game.legalTargets(humanId, card);
  if (!targets.length) return notify("这张牌当前不能主动使用");
  busy = true;
  selectedCard = index;
  render();
  try {
    const target = await chooseTarget(targets, `为【${CARD_NAMES[card.name]}】选择目标`);
    if (target !== null) {
      const chosenIndex = selectedCard, chosenCard = playableCards(game.player(humanId))[chosenIndex];
      const action = chosenCard.type === "attack"
        ? () => resolveAttackChain(humanId, chosenIndex, target)
        : chosenCard.name === "magicBullet" ? () => resolveMagicChain(humanId, chosenIndex, target)
          : () => game.playWithDecisions(humanId, chosenIndex, target, { chooseResponse: chooseCombatResponse, overflow: overflowPolicy, resolveOverflow: resolveHumanOverflow });
      await completeHumanAction(action);
    } else {
      selectedCard = null; busy = false;
      elements.hint.textContent = "[攻击行动]或者[法术行动]";
      render();
    }
  } catch (error) {
    if (error instanceof Cancelled) throw error;
    notify(error.message); selectedCard = null; busy = false; render();
  }
}

function chooseTarget(targets, hint, selection = {}) {
  elements.hint.textContent = hint;
  return session.wait(resolve => {
    const choice = { targets, ...selection, resolve(targetId) {
      if (targetId === null && choice.canCancel === false) return;
      if (targetId === null || choice.targets.includes(targetId)) { if (targetId !== null) director.captureHand(); resolve(targetId); }
    } };
    targetChoice = choice;
    render();
    return () => { targetChoice = null; render(); };
  });
}

let finishAction;
async function completeHumanAction(action) {
  director.captureHand();
  const active = session;
  acceptingAction = false;
  selectedCard = null;
  busy = true;
  render();
  try { await action(); }
  catch (error) { active.assert(); acceptingAction = true; busy = false; render(); throw error; }
  active.assert();
  await resolveHumanOverflow();
  active.assert();
  flushLog();
  busy = false;
  events.push({ type: "action", current: game.current });
  finishAction?.();
}

function renderSkillControls(locked) {
  const entries = game.legalSkillActions(humanId);
  for (const node of document.querySelectorAll(".hero-action")) if (!entries.some(entry => entry.skillId === node.dataset.skill)) node.remove();
  for (const entry of entries) {
    let button = document.querySelector(`.hero-action[data-skill="${entry.skillId}"]`);
    if (!button) {
      button = document.createElement("button"); button.className = "hero-action"; button.dataset.skill = entry.skillId; button.textContent = entry.name;
      button.addEventListener("click", () => launch(() => selectSkillAction(entry.skillId)));
      document.querySelector("#control").append(button);
    }
    button.disabled = locked;
  }
}
async function selectSkillAction(skillId) {
  if (!acceptingAction || busy) return;
  const entry = game.legalSkillActions(humanId).find(entry => entry.skillId === skillId);
  if (!entry) return;
  const active = session;
  busy = true; render();
  try {
    let mode;
    if (entry.spec.modes) {
      mode = await choose(`${entry.name}：选择效果`, entry.spec.modes, { cancel: true });
      active.assert(); if (mode == null) return;
    }
    const spec = { ...game.skillActionSpec(humanId, { skillId, mode }) }, player = game.player(humanId);
    let cardIds = [];
    if ((spec.cardCount ?? 0) > 0 || spec.cardCounts) {
      const sets = cardSets(player.hand,spec).map(cards=>cards.map(c=>player.hand.indexOf(c)));
      const indexes = await chooseHand(`${entry.name}：选择手牌`, player.hand, {
        count:spec.cardCounts ? null : spec.cardCount, valid:[...new Set(sets.flat())], validSets:sets, cancel:true,cancelLabel:"取消" });
      active.assert(); if (indexes == null) return;
      cardIds = indexes.map(index => player.hand[index].id);
    }
    const counts = targetCounts(spec,cardIds.length);
    if (counts.length > 1) {
      const count = await choose(`${entry.name}：目标人数`, counts.map(value=>({value,label:`${value}人`})), {cancel:true});
      active.assert(); if (count == null) return; spec.targetCount=count;
    } else spec.targetCount=counts[0];
    if (cardIds.length === 1) selectedCard = player.hand.findIndex(card => card.id === cardIds[0]);
    const targetIds = [];
    for (let i = 0; i < (spec.targetCount ?? 1); i++) {
      const id = await chooseTarget(spec.targets.filter(id => !targetIds.includes(id)), `${entry.name}：选择目标`, { skillCards: cardIds, cardFilter: spec.cardFilter });
      active.assert(); if (id == null) return;
      targetIds.push(id);
    }
    await completeHumanAction(() => game.executeAction(humanId, { type: "skill", skillId, mode, cardIds, targetIds }, { chooseResponse: chooseCombatResponse, overflow: overflowPolicy, resolveOverflow: resolveHumanOverflow }));
  } finally { active.assert(); busy = false; selectedCard = null; render(); }
}

async function promptActivation() {
  const state = game.turn.state;
  if (!state || state.activationDone || state.activationPrompted) return;
  state.activationPrompted = true;
  const skills = game.activationChoices(humanId);
  if (!skills.length) { state.activationDeclined = true; return; }
  const available = skills.filter(skill => !skill.blockedReason);
  const detail = skills.filter(skill => skill.blockedReason).map(skill => `因无法行动限制，你不能发动 ${skill.name}。`).join('\n');
  const title = skills.length === 1 ? (skills[0].blockedReason ? detail : `是否发动 启动-${skills[0].name}？`) : '是否启动？';
  const skillId = await choose(title, [{value:null,label:'不发动'}, ...available.map(skill => ({value:skill.id,label:`发动${skill.name}`}))], {detail: skills.length > 1 ? detail : ''});
  if (skillId == null) { state.activationDeclined = true; return; }
  await game.executeAction(humanId, {type:'activate'}, {activationSkill:skillId, chooseResponse:chooseCombatResponse, overflow:overflowPolicy, resolveOverflow:resolveHumanOverflow});
}

async function waitForHumanAction() {
  await awaitPresentation();
  await promptActivation();
  await awaitPresentation();
  if (!game.turn.needsAction()) return;
  acceptingAction = true;
  elements.hint.textContent = game.canRefreshUnableHand(humanId) ? "除提炼外无合法行动，可申请换全手；换后仍须行动" : game.turn.hasExtraActions() ? "额外行动，或结束回合" : "[攻击行动]或者[法术行动]";
  render();
  if (keyboardMode) elements.hand.querySelector("button:enabled")?.focus();
  return session.wait(resolve => { finishAction = resolve; return () => { finishAction = null; }; });
}

async function executeAi(actorId, scriptedAction = null, retried = false) {
  const active = session;
  const action = scriptedAction || (modelEnabled ? await modelChoice(game, actorId) : chooseAiAction(game, actorId));
  active.assert();
  try {
  if (action.type === "activate") await game.executeAction(actorId, action, { chooseResponse: chooseCombatResponse, overflow: overflowPolicy, resolveOverflow: resolveHumanOverflow });
  else if (action.type === "refresh") await game.executeAction(actorId, action, { overflow: overflowPolicy, resolveOverflow: resolveHumanOverflow });
  else if (action.type === "purchase") await game.executeAction(actorId, action, { overflow: overflowPolicy, resolveOverflow: resolveHumanOverflow });
  else if (action.type === "synthesize") await game.executeAction(actorId, action, { overflow: overflowPolicy, resolveOverflow: resolveHumanOverflow });
  else if (action.type === "refine") await game.executeAction(actorId, action, { overflow: overflowPolicy, resolveOverflow: resolveHumanOverflow });
  else if (action.type === "skill") await game.executeAction(actorId, action, { chooseResponse: chooseCombatResponse, overflow: overflowPolicy, resolveOverflow: resolveHumanOverflow });
  else if (action.type === "pass") {
    game.skipExtraActions(actorId);
  }
  else {
    const card = playableCards(game.player(actorId))[action.index];
    const options = { chooseResponse: chooseCombatResponse, overflow: overflowPolicy, resolveOverflow: resolveHumanOverflow };
    if (card.type === "attack") await resolveAttackChain(actorId, action.index, action.targetId);
    else if (card.name === "magicBullet") await resolveMagicChain(actorId, action.index, action.targetId);
    else {
      active.assert();
      await game.playWithDecisions(actorId, action.index, action.targetId, options);
    }
  }
  } catch (error) {
    if (error.actionInvalidated && !retried && !game.winner) return executeAi(actorId, null, true);
    throw error;
  }
  active.assert();
  await resolveHumanOverflow();
}

// Skills may start the same attack/magic resolution as physical card actions.
// Route both through one callback so AI decisions and human pending choices agree.
async function chooseCombatResponse(context) {
  return chooseSeatResponse(context);
}
async function chooseSeatResponse(context) {
  const active = session;
  active.assert();
  if (!isHuman(context.target.id)) return chooseAiResponse(game, context);
  const attack = context.attack;
  const targets = attack ? context.counterTargets.map(player => player.id) : context.nextTarget ? [context.nextTarget.id] : [];
  const title = context.title ?? `${context.actor.name}对你使用【${attack ? CARD_NAMES[attack.name] : "魔弹"}】`;
  if (!context.valid.length && playMode !== "developer") {
    enqueuePresentation(async () => {
      presenting = false;
      await withControlledSeat(context.target.id, () => chooseResponseTarget(title, [], [], attack ? "attack" : "magic"), { presented: true });
    });
    return null;
  }
  await awaitPresentation();
  return withControlledSeat(context.target.id, () => chooseResponseTarget(title, context.valid, targets, attack ? "attack" : "magic"));
}
async function resolveAttackChain(actorId, handIndex, targetId) {
  return game.attackWithDecisions(actorId, handIndex, targetId, {
    overflow: overflowPolicy,
    resolveOverflow: resolveHumanOverflow,
    chooseResponse: chooseCombatResponse,
  });
}

async function resolveMagicChain(actorId, handIndex, targetId) {
  return game.playMagicWithDecisions(actorId, handIndex, {
    targetId,
    overflow: overflowPolicy,
    resolveOverflow: resolveHumanOverflow,
    chooseResponse: chooseCombatResponse,
  });
}

async function turnGate(active) {
  if (isDev && paused) await active.wait(resolve => { resumeTurn = resolve; return () => { resumeTurn = null; }; });
  active.assert();
}

const refreshHand = document.createElement("button"); refreshHand.id = "refresh-unable"; refreshHand.textContent = "申请无法行动换牌";
$("#control").append(refreshHand);
refreshHand.addEventListener("click", () => launch(async () => {
  if (!acceptingAction || busy || !game.canRefreshUnableHand(humanId)) return;
  const active = session;
  busy = true; render();
  try {
    await game.executeAction(humanId, { type: "refresh" }, { overflow: overflowPolicy, resolveOverflow: resolveHumanOverflow });
    active.assert(); flushLog(); acceptingAction = false; finishAction?.();
  } finally { if (session === active) { busy = false; render(); } }
}));
const activateTurn = document.createElement("button"); activateTurn.id = "activate-turn"; activateTurn.textContent = "启动";
$("#control").prepend(activateTurn);
activateTurn.addEventListener("click", () => launch(async () => {
  if (!acceptingAction || busy || !game.canActivate(humanId)) return;
  game.turn.state.activationPrompted = false;
  await completeHumanAction(() => promptActivation());
}));
const endExtra = document.createElement("button"); endExtra.id = "end-extra"; endExtra.textContent = "结束回合";
$("#control").append(endExtra);
endExtra.addEventListener("click", () => {
  if (acceptingAction && !busy && game.turn.hasExtraActions()) { game.skipExtraActions(humanId); acceptingAction = false; finishAction?.(); render(); }
});

function scriptedSceneAction(playerId) {
  if (!isDev || events.length !== 1) return null;
  if (sceneId === "magic-fusion-human") return { type: "skill", skillId: "magicFusion", cardIds: [game.player(playerId).hand[0].id], targetIds: [humanId] };
  return ["attack", "attack-switch", "attack-empty", "shield-hit", "magic", "magic-empty", "magic-linked"].includes(sceneId) ? { type: "play", index: 0, targetId: humanId } : null;
}

async function runTurns(active) {
  while (!game.winner) {
    active.assert();
    if (!isHuman(game.current)) await turnGate(active);
    const player = game.player(game.current);
    if (["developer", "team"].includes(playMode) && isHuman(player.id)) { await awaitPresentation(); setPerspective(player.id); }
    events.push({ type: "turn-start", current: player.id });
    appendLog(`━━━━━━━━ ${game.actorLabel(player.id)}回合开始 ━━━━━━━━`, true);
    if (!presentationPending) elements.hint.textContent = isHuman(player.id) ? "准备行动" : "对手思考中";
    render();
    const turn = await game.beginTurn(player.id, {
      chooseWeakness: async () => isHuman(player.id)
        ? (await awaitPresentation(), choose("【虚弱】触发", [{ value: "draw", label: "摸3张牌并继续" }, { value: "skip", label: "跳过本回合行动" }]))
        : modelEnabled ? modelChoice(game, player.id, { type: "weakness", playerId: player.id }) : chooseAiRuleDecision({ type: "weakness", playerId: player.id }, game),
      resolveOverflow: resolveHumanOverflow,
    }, { overflow: overflowPolicy });
    active.assert();
    await resolveHumanOverflow();
    flushLog();
    do {
    if (!turn.skipped && !game.winner) {
      if (isHuman(player.id)) {
        await waitForHumanAction();
      } else { await delay(isDev ? 0 : 150); await executeAi(player.id, scriptedSceneAction(player.id)); active.assert(); flushLog(); }
    }
    if (!modelEnabled && !isHuman(player.id) && game.turn.hasExtraActions() && !game.legalCards(player.id).length && !game.legalSkillActions(player.id).length) game.skipExtraActions(player.id);
    } while (game.turn.needsAction());
    active.assert();
    if (game.winner) { break; }
    events.push({ type: "turn-end", current: player.id });
    appendLog(`━━━━━━━━ ${game.actorLabel(player.id)}回合结束 ━━━━━━━━`, true);
    await game.endTurnWithDecisions({ overflow: overflowPolicy, resolveOverflow: resolveHumanOverflow, chooseResponse: chooseCombatResponse });
    active.assert();
    flushLog();
    if (playMode === "test" && player.id === humanId && !game.winner) {
      render();
      await awaitPresentation();
      const repeat = await choose("你的回合已结束", [{ value: true, label: "重复回合" }, { value: false, label: "不重复" }]);
      active.assert();
      if (repeat) game.turn.repeatLast(humanId);
    }
    if (!game.winner && !presentationPending) elements.hint.textContent = `${game.player(game.current).name}准备行动`;
    render();
    if (game.winner) break;
    await delay(isDev ? 0 : 100);
  }
  await awaitPresentation();
  acceptingAction = false;
  render();
  await gameRecorder?.finish();
  active.assert();
  await choose("游戏结束", [{ value: true, label: "再来一局" }], { detail: `${game.winner === "red" ? "红方" : "蓝方"}获胜` });
  active.assert();
  newGame();
}

function chooseStones(title, stones, min, max) {
  return session.wait(resolve => {
    const previousFocus = document.activeElement;
    const selected = new Set();
    const kinds = [...Array(stones.gem).fill("gem"), ...Array(stones.crystal).fill("crystal")];
    pendingChoice = { type: "stones", title, min, max, selected: [] };
    elements.modalTitle.textContent = title;
    elements.modalBody.innerHTML = `<div class="choice-list" aria-label="选择${min === max ? min : `${min}至${max}`}个星石"></div>`;
    elements.modalActions.replaceChildren();
    const confirm = document.createElement("button");
    confirm.textContent = "确认"; confirm.disabled = true;
    const cancel = document.createElement("button"); cancel.textContent = "取消";
    for (const [index, kind] of kinds.entries()) {
      const button = document.createElement("button"); button.className = "stone-choice";
      button.textContent = kind === "gem" ? "宝石" : "水晶";
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => {
        if (selected.has(index)) selected.delete(index);
        else if (selected.size < max) selected.add(index);
        button.classList.toggle("selected", selected.has(index));
        button.setAttribute("aria-pressed", String(selected.has(index)));
        pendingChoice.selected = [...selected];
        confirm.disabled = selected.size < min || selected.size > max;
      });
      elements.modalBody.querySelector(".choice-list").append(button);
    }
    function submit() {
      if (selected.size < min || selected.size > max) return;
      resolve({ gem: [...selected].filter(index => kinds[index] === "gem").length, crystal: [...selected].filter(index => kinds[index] === "crystal").length });
    }
    confirm.addEventListener("click", submit);
    cancel.addEventListener("click", () => resolve(null));
    elements.modalActions.append(confirm, cancel);
    openModal();
    if (keyboardMode) elements.modalBody.querySelector("button")?.focus();
    return () => { pendingChoice = null; closeModal(); previousFocus?.focus(); };
  });
}

async function specialAction(type) {
  if (!acceptingAction || busy || targetChoice) return;
  busy = true;
  render();
  const active = session;
  try {
    if (type === "buy") await completeHumanAction(() => game.executeAction(humanId, { type: "purchase" }, { overflow: overflowPolicy, resolveOverflow: resolveHumanOverflow }));
    if (type === "synth") {
      const stones = game.stoneCounts(game.player(humanId).team);
      const picked = await chooseStones("合成：选择星石", stones, 3, 3);
      if (picked) await completeHumanAction(() => game.executeAction(humanId, { type: "synthesize", gemCount: picked.gem }, { overflow: overflowPolicy, resolveOverflow: resolveHumanOverflow }));
    }
    if (type === "refine") {
      const player = game.player(humanId), stones = game.stoneCounts(player.team);
      const capacity = game.getEnergyLimit(humanId) - player.energy.gem - player.energy.crystal;
      const picked = await chooseStones("提炼：选择星石", stones, 1, Math.min(2, stones.total, capacity));
      if (picked) await completeHumanAction(() => game.executeAction(humanId, { type: "refine", stones: picked }));
    }
  } catch (error) {
    if (error instanceof Cancelled) throw error;
    notify(error.message);
  } finally {
    if (!active.cancelled) { busy = false; render(); }
  }
}

for (const type of ["buy", "synth", "refine"]) elements[type].addEventListener("click", () => launch(() => specialAction(type)));
$("#cancel-target").addEventListener("click", () => targetChoice?.resolve(null));
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    if (targetChoice) targetChoice.resolve(null);
    else handChoice?.cancel?.();
  }
});
$("#restart").addEventListener("click", () => newGame());
$("#clear-log").addEventListener("click", () => { actionLog = []; elements.log.replaceChildren(); });
function setLog(open) {
  logPause = open; updatePause();
  $("#log-panel").hidden = !open;
  $("#toggle-log").setAttribute("aria-expanded", String(open));
}
$("#toggle-log").addEventListener("click", () => setLog($("#log-panel").hidden));
const pauseButton = document.createElement('button');
pauseButton.id = 'pause-playback'; pauseButton.textContent = '暂停';
pauseButton.addEventListener('click', () => { manualPause = !manualPause; updatePause(); });
$('#toggle-log').after(pauseButton);
document.addEventListener('visibilitychange', updatePause);
window.addEventListener('pageshow', updatePause);
$("#close-log").addEventListener("click", () => setLog(false));
$("#deck-info").addEventListener("click", () => notify(`牌库 ${shownGame.deck.length} 张，弃牌 ${shownGame.discard.length} 张`));
$("#sort-hand").addEventListener("click", () => {
  if (playMode === "spectate" || presenting || busy || targetChoice || pendingChoice) return;
  game.player(humanId).hand.sort(compareHandCards);
  shownGame = presentationView(game.presentationSnapshot(), game);
  gameRecorder?.sorted(humanId);
  selectedCard = null;
  render();
});
function resize() { director?.finish(); resizeStage(); if (game) layoutHand(elements.hand); }
window.addEventListener("resize", resize);
resize();

if (isDev) {
  const { createScene, sceneNames } = await import("/web/scenes.js");
  paused = true;
  const select = $("#dev-scene");
  for (const [value, label] of Object.entries(sceneNames)) select.add(new Option(label, value));
  const requested = new URLSearchParams(location.search).get("scene");
  select.value = Object.hasOwn(sceneNames, requested) ? requested : "opening";
  function resetScene() {
    const id = select.value;
    history.replaceState(null, "", `?scene=${id}`);
    newGame(createScene(id), 20260905, id);
    // Enter actual supported interactions, rather than drawing a mock modal.
    const active = session;
    if (id === "target") launch(async () => {
      while (!acceptingAction) await active.delay(16);
      active.assert();
      await completeHumanAction(() => game.executeAction(humanId, { type: "activate" }, { overflow: overflowPolicy }));
      while (!acceptingAction) await active.delay(16);
      active.assert(); await selectCard(0);
    });
  }
  select.addEventListener("change", resetScene);
  $("#dev-reset").addEventListener("click", resetScene);
  $("#dev-pause").addEventListener("click", event => {
    paused = !paused;
    event.target.textContent = paused ? "继续 AI" : "暂停 AI";
    if (!paused) resumeTurn?.();
  });
  $("#dev-step").addEventListener("click", () => { paused = true; $("#dev-pause").textContent = "继续 AI"; resumeTurn?.(); });
  function exportState() {
    game.assertCardLocations();
    return { display: { current: shownGame.current, handCount: shownGame.player(humanId).hand.length, field: shownGame.field, paused: playback.paused }, seed, scene: sceneId, paused, current: game.current, phase: targetChoice ? "target" : pendingChoice ? "choice" : acceptingAction ? "action" : "turn", selectedCard, legalTargets: targetChoice?.targets || [], pendingChoice, perspective: humanId,
      game: { players: game.players.map(player => player.toJSON()), teams: game.teams, deck: game.deck.map(card => card.toJSON()), discard: game.discard.map(card => card.toJSON()), field: game.field.map(card => card.toJSON()), outside: game.outside.map(card => card.toJSON()), winner: game.winner, turn: game.turn.state, timeline: game.timeline }, events, log: actionLog };
  }
  // Developer-only interface shared with the browser verification tool.
  window.xingbeiDev = { reset: resetScene, exportState, step: () => resumeTurn?.(),
    animations: () => ({ playing: presenting, active: director.active.size, trace: director.trace }),
    finishAnimations: () => director.finish(), pauseAnimations: value => director.pause(value), stepAnimation: () => director.step(),
    setMotion: mode => { animationMode = mode === "off" ? "off" : "normal"; director.mode = animationMode; director.pause(false); director.finish(); },
  };
  const pauseEffects = document.createElement("button"); pauseEffects.textContent = "暂停效果";
  pauseEffects.addEventListener("click", () => { director.pause(!director.paused); pauseEffects.textContent = director.paused ? "播放效果" : "暂停效果"; }); $(".dev-tools").append(pauseEffects);
  const stepEffects = document.createElement("button"); stepEffects.textContent = "单步效果";
  stepEffects.addEventListener("click", () => { director.step(); pauseEffects.textContent = "播放效果"; }); $(".dev-tools").append(stepEffects);
  const finish = document.createElement("button"); finish.textContent = "结束当前动画";
  finish.addEventListener("click", () => director.finish()); $(".dev-tools").append(finish);
  const motion = document.createElement("button"); motion.textContent = animationMode === "off" ? "开启动画" : "关闭动画";
  motion.addEventListener("click", () => {
    animationMode = animationMode === "off" ? "normal" : "off"; director.mode = animationMode; director.pause(false); director.finish();
    motion.textContent = animationMode === "off" ? "开启动画" : "关闭动画";
  }); $(".dev-tools").append(motion);
  $("#dev-export").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(exportState(), null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `xingbei-${sceneId}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  resetScene();
} else newGame();
