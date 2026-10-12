import { getAvailableHeroes } from "/src/hero.js";
import { CARD_NAMES, ELEMENT_NAMES, FATE_NAMES } from "/src/cards.js";
import { Game } from "/src/engine.js";
import { chooseAiAction, chooseAiResponse, chooseAiRuleDecision } from "/src/ai.js";
import { compareHandCards } from "/src/cards.js";

import { renderTeams, renderPlayers as paintPlayers, renderHand as paintHand, resizeStage, layoutHand, cardContents, cardLabel } from "/web/render.js";
import { AnimationDirector, presentationView, preloadAnimationAssets } from "/web/animation.js";
import { Session, Cancelled } from "/web/session.js";

const humanId = 0;
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

let game;
let director = null;
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
let paused = false;
let resumeTurn = null;
let seed;
let sceneId = null;
let events = [];
let keyboardMode = false;
document.addEventListener("keydown", () => { keyboardMode = true; });
document.addEventListener("pointerdown", () => { keyboardMode = false; });
const isDev = location.pathname === "/web/dev.html";
const overflowPolicy = player => player.id === humanId ? "defer" : "random";

function launch(task) {
  void Promise.resolve().then(task).catch(error => {
    if (!(error instanceof Cancelled)) { console.error(error); notify(error.message); }
  });
}

function newGame(nextGame = null, nextSeed = Date.now(), id = null) {
  session.cancel();
  director?.dispose();
  session = new Session();
  shownGame = null; presenting = false;
  seed = nextSeed;
  sceneId = id;
  game = nextGame || new Game({ seed });
  game.onDecision = chooseRuleDecision;
  acceptingAction = false;
  busy = false;
  selectedCard = null;
  targetChoice = null;
  pendingChoice = null;
  handChoice = null;
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
  director = new AnimationDirector($("#arena"), active, { mode: animationMode });
  const currentDirector = director;
  presenting = true; render();
  const onPresentation = async batch => {
    active.assert(); presenting = true; render();
    try {
      for (const event of batch) {
        active.assert();
        const playerName = event.playerId != null ? game.player(event.playerId).name : "";
        if (event.type === "move" && event.reason === "play") elements.hint.textContent = `${game.player(event.from.playerId).name}使用【${CARD_NAMES[event.card.name]}】`;
        if (event.type === "draw") elements.hint.textContent = `${playerName}摸${event.cards.length}张牌`;
        if (event.type === "relay") elements.hint.textContent = `${game.player(event.sourceId).name}向${playerName}传递【魔弹】`;
        if (event.type === "damage") elements.hint.textContent = `${playerName}承受${event.amount}点${event.damageType === "spell" ? "法术" : "攻击"}伤害`;
        if (event.type === "miss") elements.hint.textContent = `${playerName}：未命中`;
        if (currentDirector.instant && ["damage", "miss", "winner"].includes(event.type)) {
          const name = event.playerId != null ? game.player(event.playerId).name : "";
          notify(event.type === "damage" ? `${name}承受${event.amount}点${event.damageType === "spell" ? "法术" : "攻击"}伤害` : event.type === "miss" ? `${name}：未命中` : `${event.team === "red" ? "红方" : "蓝方"}获胜`);
        }
        await currentDirector.show(event, snapshot => { active.assert(); shownGame = presentationView(snapshot, game); render(); });
      }
    } finally { if (session === active) { presenting = false; render(); } }
  };
  game.enablePresentation(onPresentation);
  launch(async () => {
    active.assert();
    if (!nextGame) {
      const playerHeroId = await choose("选择角色", getAvailableHeroes().map(hero => ({ value: hero.id, label: hero.name })));
      active.assert();
      game = new Game({ seed, playerHeroId, playerSeat: humanId }).setup();
      game.onDecision = chooseRuleDecision;
      game.enablePresentation(onPresentation);
      render();
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
      }
    }
    await preloadAnimationAssets(); await document.fonts.ready; active.assert();
    presenting = false; render();
    await runTurns(active);
  });
}

function render() {
  const view = shownGame || game;
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
  $("#sort-hand").disabled = presenting || busy || !!targetChoice || !!pendingChoice;
  const locked = presenting || !acceptingAction || busy || !!targetChoice;
  endExtra.hidden = !game.turn.hasExtraActions(); endExtra.disabled = locked;
  elements.buy.disabled = locked || !game.canDrawSpecial(humanId);
  elements.synth.disabled = locked || !game.canDrawSpecial(humanId) || stones.total < 3;
  elements.refine.disabled = locked || !game.canRefine(humanId);
  elements.buy.hidden = !game.canDrawSpecial(humanId) || !!targetChoice;
  elements.synth.hidden = !game.canDrawSpecial(humanId) || stones.total < 3 || !!targetChoice;
  renderSkillControls(locked);
  elements.refine.hidden = !game.canRefine(humanId) || !!targetChoice;
  $("#cancel-target").hidden = !targetChoice;
  $("#control").hidden = !!pendingChoice;
  $(".center-hint").hidden = !!pendingChoice && !["hand", "target"].includes(pendingChoice.type);
}

function renderPlayers(view = shownGame || game) {
  paintPlayers(view, elements.players, humanId, presenting ? null : targetChoice?.targets);
  for (const node of elements.players.children) node.onclick = null;
  if (targetChoice && !presenting) {
    const choice = targetChoice;
    for (const node of elements.players.querySelectorAll(".targetable")) {
      node.onclick = () => choice.resolve(Number(node.dataset.player));
    }
  }
}

function appendLog(message, turn = false) {
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
  shownGame = null;
  if (game.log.length) appendLog(game.log.splice(0).join("\n"));
  render();
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

async function chooseRuleDecision(request) {
  if (request.type === "playerChoice") {
    if (request.playerId !== humanId) return chooseAiRuleDecision(request);
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
    if (request.playerId !== humanId) return chooseAiRuleDecision(request);
    return chooseHand(request.title, game.player(humanId).hand, { count: request.count, valid: request.valid, cancel: request.optional });
  }
  if (!request.choices) return null;
  if (request.playerId !== humanId) return chooseAiRuleDecision(request);
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

function chooseHand(title, cards, { count = 1, valid = cards.map((_, index) => index), cancel = false, cancelLabel = "不响应" } = {}) {
  return session.wait(resolve => {
    const previousHint = elements.hint.textContent;
    const previousFocus = document.activeElement;
    const selected = new Set();
    pendingChoice = { title, type: "hand", count, valid, selected: [] };
    elements.hint.textContent = title;
    elements.modalActions.replaceChildren();
    const confirm = document.createElement("button");
    confirm.textContent = count > 1 ? "确认弃置" : "确定"; confirm.disabled = true;
    handChoice = { valid, selected, select(index) {
      if (!valid.includes(index)) return;
      selected.has(index) ? selected.delete(index) : selected.add(index);
      pendingChoice.selected = [...selected];
      confirm.disabled = selected.size !== count;
      render();
    } };
    confirm.addEventListener("click", () => { director.captureHand(); resolve([...selected]); });
    elements.modalActions.append(confirm);
    if (cancel) {
      const button = document.createElement("button"); button.textContent = "不响应";
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
    handChoice = { valid: pendingChoice.valid, selected, cancel: clearSelection, select(index) {
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

async function resolveHumanOverflow() {
  const active = session;
  const player = game.player(humanId);
  if (player.hand.length <= player.handLimit) return;
  const indexes = await chooseCards("爆牌", player.hand, player.hand.length - player.handLimit);
  active.assert();
  await game.resolveOverflowWithDecisions(humanId, indexes, player.pendingOverflow ?? {});
  await game.flushPresentation();
  active.assert();
  flushLog();
}

async function selectCard(index) {
  if (!acceptingAction) return;
  if (targetChoice) {
    if (selectedCard === index) { targetChoice.resolve(null); return; }
    if (targetChoice.skillCards) {
      if (targetChoice.skillCards.length !== 1) return;
      const card = game.player(humanId).hand[index];
      if (!(targetChoice.cardFilter?.(card) ?? true)) return;
      targetChoice.skillCards[0] = card.id; selectedCard = index; render(); return;
    }
    const card = game.player(humanId).hand[index], targets = game.legalTargets(humanId, card);
    if (!targets.length) return;
    selectedCard = index; targetChoice.targets = targets;
    elements.hint.textContent = `为【${CARD_NAMES[card.name]}】选择目标`; render(); return;
  }
  if (busy) return;
  const card = game.player(humanId).hand[index];
  const targets = game.legalTargets(humanId, card);
  if (!targets.length) return notify("这张牌当前不能主动使用");
  busy = true;
  selectedCard = index;
  render();
  try {
    const target = await chooseTarget(targets, `为【${CARD_NAMES[card.name]}】选择目标`);
    if (target !== null) {
      const chosenIndex = selectedCard, chosenCard = game.player(humanId).hand[chosenIndex];
      const action = chosenCard.type === "attack"
        ? () => resolveAttackChain(humanId, chosenIndex, target)
        : chosenCard.name === "magicBullet" ? () => resolveMagicChain(humanId, chosenIndex)
          : () => game.playWithDecisions(humanId, chosenIndex, target, { autoRespond: true, overflow: overflowPolicy });
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
    if (spec.targetCounts) {
      const count = await choose(`${entry.name}：目标人数`, spec.targetCounts.map(value => ({ value, label: `${value}人` })), { cancel: true });
      active.assert(); if (count == null) return; spec.targetCount = count;
    }
    let cardIds = [];
    if (spec.cardCount) {
      const valid = player.hand.flatMap((card, index) => (spec.cardFilter?.(card) ?? true) ? [index] : []);
      const indexes = await chooseHand(`${entry.name}：选择手牌`, player.hand, { count: spec.cardCount, valid, cancel: true, cancelLabel: "取消" });
      active.assert(); if (indexes == null) return;
      cardIds = indexes.map(index => player.hand[index].id);
    }
    if (cardIds.length === 1) selectedCard = player.hand.findIndex(card => card.id === cardIds[0]);
    const targetIds = [];
    for (let i = 0; i < (spec.targetCount ?? 1); i++) {
      const id = await chooseTarget(spec.targets.filter(id => !targetIds.includes(id)), `${entry.name}：选择目标`, { skillCards: cardIds, cardFilter: spec.cardFilter });
      active.assert(); if (id == null) return;
      targetIds.push(id);
    }
    await completeHumanAction(() => game.executeAction(humanId, { type: "skill", skillId, mode, cardIds, targetIds }, { overflow: overflowPolicy, resolveOverflow: resolveHumanOverflow }));
  } finally { active.assert(); busy = false; selectedCard = null; render(); }
}

async function waitForHumanAction() {
  acceptingAction = true;
  elements.hint.textContent = game.turn.hasExtraActions() ? "额外攻击行动，或结束回合" : "[攻击行动]或者[法术行动]";
  render();
  if (keyboardMode) elements.hand.querySelector("button:enabled")?.focus();
  return session.wait(resolve => { finishAction = resolve; return () => { finishAction = null; }; });
}

async function executeAi(actorId, scriptedAction = null) {
  const active = session;
  const action = scriptedAction || chooseAiAction(game, actorId);
  if (action.type === "refresh") await game.executeAction(actorId, action);
  else if (action.type === "purchase") await game.executeAction(actorId, action, { overflow: "random" });
  else if (action.type === "synthesize") await game.executeAction(actorId, action, { overflow: "random" });
  else if (action.type === "refine") await game.executeAction(actorId, action, { overflow: overflowPolicy, resolveOverflow: resolveHumanOverflow });
  else if (action.type === "skill") await game.executeAction(actorId, action, { overflow: overflowPolicy, resolveOverflow: resolveHumanOverflow });
  else if (action.type === "pass") game.log.push(`${game.player(actorId).name}跳过行动`);
  else {
    const card = game.player(actorId).hand[action.index];
    const options = { autoRespond: id => id !== humanId, overflow: overflowPolicy };
    if (card.type === "attack") await resolveAttackChain(actorId, action.index, action.targetId);
    else if (card.name === "magicBullet") await resolveMagicChain(actorId, action.index);
    else {
      active.assert();
      await game.playWithDecisions(actorId, action.index, action.targetId, options);
    }
  }
  active.assert();
  await resolveHumanOverflow();
}

async function resolveAttackChain(actorId, handIndex, targetId) {
  return game.attackWithDecisions(actorId, handIndex, targetId, {
    overflow: overflowPolicy,
    resolveOverflow: resolveHumanOverflow,
    chooseResponse: context => {
      const { actor, target, valid, counterTargets } = context;
      if (target.id === humanId) return chooseResponseTarget(`${actor.name}对你使用【${CARD_NAMES[context.attack.name]}】`, valid, counterTargets.map(player => player.id));
      return chooseAiResponse(game, context);
    },
  });
}

async function resolveMagicChain(actorId, handIndex) {
  return game.playMagicWithDecisions(actorId, handIndex, {
    overflow: overflowPolicy,
    resolveOverflow: resolveHumanOverflow,
    chooseResponse: context => {
      const { actor, target, valid, nextTarget } = context;
      if (target.id === humanId) return chooseResponseTarget(`${actor.name}对你使用【魔弹】`, valid, nextTarget ? [nextTarget.id] : [], "magic");
      return chooseAiResponse(game, context);
    },
  });
}

async function turnGate(active) {
  if (isDev && paused) await active.wait(resolve => { resumeTurn = resolve; return () => { resumeTurn = null; }; });
  active.assert();
}

const endExtra = document.createElement("button"); endExtra.id = "end-extra"; endExtra.textContent = "结束回合";
$("#control").append(endExtra);
endExtra.addEventListener("click", () => {
  if (acceptingAction && !busy && game.turn.hasExtraActions()) { game.skipExtraActions(humanId); acceptingAction = false; finishAction?.(); render(); }
});

async function runTurns(active) {
  while (!game.winner) {
    active.assert();
    if (game.current !== humanId) await turnGate(active);
    const player = game.player(game.current);
    events.push({ type: "turn-start", current: player.id });
    appendLog(`━━━━━━━━ ${player.name}回合开始 ━━━━━━━━`, true);
    elements.hint.textContent = player.id === humanId ? "准备行动" : "对手思考中";
    render();
    const turn = await game.beginTurn(player.id, {
      chooseWeakness: () => player.id === humanId
        ? choose("【虚弱】触发", [{ value: "draw", label: "摸3张牌并继续" }, { value: "skip", label: "跳过本回合行动" }])
        : (game.random() < .5 ? "draw" : "skip"),
      resolveOverflow: resolveHumanOverflow,
    }, { overflow: overflowPolicy });
    active.assert();
    await resolveHumanOverflow();
    flushLog();
    do {
    if (!turn.skipped && !game.winner) {
      if (player.id === humanId) {
        if (game.canRefreshUnableHand(humanId)) {
          await choose("无法行动", [{ value: true, label: "展示并重摸" }], { detail: "所有手牌当前不可使用、空余手牌位不超过2，且无法通过英雄技能行动。你将弃置并重摸全部手牌。" });
          await game.executeAction(humanId, { type: "refresh" }, { resolveOverflow: resolveHumanOverflow }); flushLog();
        } else await waitForHumanAction();
      } else { await delay(isDev ? 0 : 150); await executeAi(player.id, isDev && ["attack", "attack-switch", "attack-empty", "shield-hit"].includes(sceneId) && events.length === 1 ? { type: "play", index: 0, targetId: humanId } : null); active.assert(); flushLog(); }
    }
    if (player.id !== humanId && game.turn.hasExtraActions() && !game.legalCards(player.id).length) game.skipExtraActions(player.id);
    } while (game.turn.hasExtraActions() && !game.winner);
    active.assert();
    events.push({ type: "turn-end", current: player.id });
    appendLog(`━━━━━━━━ ${player.name}回合结束 ━━━━━━━━`, true);
    await game.endTurnWithDecisions({ resolveOverflow: resolveHumanOverflow });
    shownGame = null;
    if (!game.winner) elements.hint.textContent = `${game.player(game.current).name}准备行动`;
    render();
    if (game.winner) break;
    await delay(isDev ? 0 : 100);
  }
  acceptingAction = false;
  render();
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
      const capacity = 3 - player.energy.gem - player.energy.crystal;
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
  $("#log-panel").hidden = !open;
  $("#toggle-log").setAttribute("aria-expanded", String(open));
}
$("#toggle-log").addEventListener("click", () => setLog($("#log-panel").hidden));
$("#close-log").addEventListener("click", () => setLog(false));
$("#deck-info").addEventListener("click", () => notify(`牌库 ${game.deck.length} 张，弃牌 ${game.discard.length} 张`));
$("#sort-hand").addEventListener("click", () => {
  if (presenting || busy || targetChoice || pendingChoice) return;
  shownGame = null;
  game.player(humanId).hand.sort(compareHandCards);
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
    if (id === "target") launch(async () => { while (!acceptingAction) await active.delay(16); active.assert(); await selectCard(0); });
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
    return { seed, scene: sceneId, paused, current: game.current, phase: targetChoice ? "target" : pendingChoice ? "choice" : acceptingAction ? "action" : "turn", selectedCard, legalTargets: targetChoice?.targets || [], pendingChoice, perspective: humanId,
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
