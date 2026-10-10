// Presentation adapted from v1.6.7 UI, music and nova. See SOURCES.md.
import { CARD_NAMES, ELEMENT_NAMES, FATE_NAMES } from "/src/cards.js";

export function cardContents(card, context = {}) {
  return `<img class="image" src="/assets/card/${card.name}.png" alt=""><span class="info"><span>${card.getTraits(context).elements.map(element => ELEMENT_NAMES[element]).join("/")}${card.getTraits(context).fates.map(fate => FATE_NAMES[fate]).join("/")}</span></span><span class="name" aria-hidden="true"></span>`;
}

export function cardLabel(card, context = {}) {
  return `${CARD_NAMES[card.name] ?? card.name} · ${card.getTraits(context).elements.map(element => ELEMENT_NAMES[element]).join("/") || "无"}系 · ${card.getTraits(context).fates.map(fate => FATE_NAMES[fate]).join("/") || "无"}命格`;
}

export function renderTeams(game, nodes, humanId) {
  for (const team of ["red", "blue"]) {
    const data = game.teams[team];
    const stones = game.stoneCounts(team);
    nodes[team].classList.toggle("highlight", game.player(humanId).team === team);
    nodes[team].innerHTML = `<td>${data.morale}</td><td class="stones">${[...Array(stones.gem)].map(() => '<img src="/assets/stones/gem.png" alt="宝石">').join("")}${[...Array(stones.crystal)].map(() => '<img src="/assets/stones/crystal.png" alt="水晶">').join("")}</td><td>${data.cups}</td>`;
  }
}

export function renderPlayers(game, container, humanId, targets = null) {
  container.replaceChildren();
  container.dataset.number = game.players.length;
  container.closest("#arena").dataset.number = game.players.length;
  for (const player of game.players) {
    const node = document.createElement("article");
    node.className = `player${player.id === game.current ? " current" : ""}`;
    node.dataset.position = (player.id - humanId + game.players.length) % game.players.length;
    node.dataset.player = player.id;
    node.dataset.team = player.team;
    node.tabIndex = targets?.includes(player.id) ? 0 : -1;
    node.classList.toggle("targetable", !!targets?.includes(player.id));
    node.classList.toggle("untargetable", !!targets && !targets.includes(player.id));
    node.setAttribute("aria-label", `${player.name}，${player.hero.name}，${player.hand.length}张手牌`);
    const marks = [];
    if (player.shield) marks.push('<img src="/assets/card/holyShield.png" title="圣盾" alt="圣盾">');
    if (player.weakness) marks.push('<img src="/assets/card/weakness.png" title="虚弱" alt="虚弱">');
    if (player.poisons.length) marks.push(`<span class="poison-mark"><img src="/assets/card/poison.png" title="中毒" alt="中毒"><b>${player.poisons.length}</b></span>`);
    const energy = [
      ["crystal", "crystal", "水晶"], ["gem", "gem", "宝石"],
    ].filter(([kind]) => player.energy[kind] > 0).map(([kind, image, label]) => `<span><img src="/assets/stones/${image}.png" alt="${label}"><b>${player.energy[kind]}</b></span>`).join("");
    node.innerHTML = `<img class="avatar" src="/assets/character/${player.hero.portrait}.jpg" alt=""><span class="player-name" title="${player.name}；头像仅作展示，角色技能尚未实现">${player.hero.name}</span><span class="identity"><span>${player.team === "red" ? "红" : "蓝"}</span></span><span class="count">${player.hand.length}/6</span><span class="hp" title="治疗 ${player.healing}" aria-label="治疗 ${player.healing}">${[1, 0].map(index => `<span class="${index < player.healing ? "" : "lost"}"></span>`).join("")}</span><span class="energy" title="个人能量" style="top:${6 + marks.length * 28}px">${energy}</span><div class="marks">${marks.reverse().join("")}</div>`;
    if (player.energy.gem + player.energy.crystal === 0) node.querySelector(".energy").hidden = true;
    node.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); node.click(); }
    });
    container.append(node);
  }
}

export function renderHand(game, container, humanId, { acceptingAction, selectedCard, locked, onSelect, handChoice = null }) {
  container.replaceChildren();
  for (const [index, card] of game.player(humanId).hand.entries()) {
    const button = document.createElement("button");
    const usable = handChoice ? handChoice.valid.includes(index) : game.legalTargets(humanId, card).length > 0;
    const selected = handChoice ? handChoice.selected.has(index) : selectedCard === index;
    button.className = `card${selected ? " selected" : ""}${usable ? "" : " unusable"}`;
    button.disabled = !acceptingAction || locked || (handChoice && !usable);
    const context = { game, playerId: humanId, purpose: "hand" };
    button.innerHTML = cardContents(card, context);
    button.title = cardLabel(card, context);
    button.setAttribute("aria-label", cardLabel(card, context));
    button.setAttribute("aria-pressed", String(selected));
    button.addEventListener("click", () => onSelect(index));
    container.append(button);
  }
  layoutHand(container);
}

// Extracted from UI.updatehl(): 112px spacing, fold down to 32px, then scroll.
export function layoutHand(container) {
  const cards = [...container.children];
  const width = container.parentElement.clientWidth;
  const spacing = cards.length <= 1 ? 112 : Math.max(32, Math.min(112, (width - 128) / (cards.length - 1)));
  container.style.width = `${cards.length ? spacing * (cards.length - 1) + 118 : 0}px`;
  container.parentElement.classList.toggle("scrollh", cards.length > 1 && spacing === 32);
  for (const [index, card] of cards.entries()) {
    card.style.setProperty("--card-x", `${index * spacing}px`);
    const info = card.querySelector(".info"), text = info.querySelector("span");
    text.style.display = "";
    const offset = Math.max(0, 100 - spacing);
    const folded = offset > 40;
    const shift = folded ? 90 - info.offsetWidth : offset;
    info.style.transform = `translateX(-${shift}px)${folded ? " translateY(-3px)" : ""}`;
    if (folded && index !== cards.length - 1) text.style.display = "none";
    card.querySelector(".name").style.transform = folded ? "translateY(16px)" : "";
  }
}

export function resizeStage() {
  const stage = document.querySelector("#window");
  // UI.updated()/updatez(), ui_zoom=big. Use the same rounded device zoom.
  const narrow = innerWidth < 900 || innerHeight < 500;
  const deviceZoom = narrow ? Math.min(Math.round(innerWidth / 98) / 10, Math.round(innerHeight / 50) / 10) : 1;
  const documentZoom = 1.05 * deviceZoom;
  const scale = Math.floor(documentZoom * 100) / 100;
  stage.style.width = `${Math.round(innerWidth / documentZoom)}px`;
  stage.style.height = `${Math.round(innerHeight / documentZoom)}px`;
  stage.style.transform = `scale(${scale})`;
  stage.dataset.narrow = String(narrow);
}
