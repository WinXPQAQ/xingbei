import { UNIQUE_SKILL_NAMES } from "/src/unique-skills.js";
// Presentation adapted from v1.6.7 UI, music and nova. See SOURCES.md.
import { CARD_NAMES, ELEMENT_NAMES, FATE_NAMES } from "/src/cards.js";

const formNames = { prayer: "祈祷", runeBurst: "蓄势迸发" };
const heroMarkers = {
  elementalist: [["elements", "元素", 3, "element"]],
  adjudicator: [["judgment", "审判", 4, "judgment"]],
  prayer: [["prayerRunes", "祈祷符文", 3, "prayerRunes"]],
  heroicPuppet: [["battleRunes", "战纹", 3, "battleRunes"], ["magicRunes", "魔纹", 3, "magicRunes"]],
};

export function cardContents(card, context = {}) {
  return `<img class="image" src="/assets/card/${card.name}.png" alt=""><span class="info"><span>${card.getTraits(context).elements.map(element => ELEMENT_NAMES[element]).join("/")}${card.getTraits(context).fates.map(fate => FATE_NAMES[fate]).join("/")}</span></span><span class="name" aria-hidden="true"></span><span class="range">${(card.uniqueSkills ?? []).map(id => UNIQUE_SKILL_NAMES[id] ?? id).join("<br>")}</span>`;
}

export function cardLabel(card, context = {}) {
  return `${CARD_NAMES[card.name] ?? card.name} · ${card.getTraits(context).elements.map(element => ELEMENT_NAMES[element]).join("/") || "无"}系 · ${card.getTraits(context).fates.map(fate => FATE_NAMES[fate]).join("/") || "无"}命格${card.uniqueSkills?.length ? " · " + card.uniqueSkills.map(id => UNIQUE_SKILL_NAMES[id] ?? id).join(" / ") : ""}`;
}

export function renderTeams(game, nodes, humanId) {
  for (const team of ["red", "blue"]) {
    const data = game.teams[team];
    const stones = game.stoneCounts(team);
    nodes[team].classList.toggle("highlight", game.player(humanId).team === team);
    const markup = `<td>${data.morale}</td><td class="stones">${[...Array(stones.gem)].map(() => '<img src="/assets/stones/gem.png" alt="宝石">').join("")}${[...Array(stones.crystal)].map(() => '<img src="/assets/stones/crystal.png" alt="水晶">').join("")}</td><td>${data.cups}</td>`;
    if (nodes[team]._markup !== markup) { nodes[team].innerHTML = markup; nodes[team]._markup = markup; }
  }
}

export function renderPlayers(game, container, humanId, targets = null, revealHands = false) {
  container.dataset.number = game.players.length;
  container.closest("#arena").dataset.number = game.players.length;
  for (const player of game.players) {
    let node = container.querySelector(`[data-player="${player.id}"]`);
    if (!node) {
      node = document.createElement("article"); node.className = "player";
      node.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); node.click(); }
      });
      container.append(node);
    }
    node.classList.toggle("current", player.id === game.current);
    node.dataset.position = (player.id - humanId + game.players.length) % game.players.length;
    node.dataset.player = player.id;
    node.dataset.team = player.team;
    node.tabIndex = targets?.includes(player.id) ? 0 : -1;
    node.classList.toggle("targetable", !!targets?.includes(player.id));
    node.classList.toggle("untargetable", !!targets && !targets.includes(player.id));
    node.setAttribute("aria-label", `${player.name}，${player.hero.name}，${player.hand.length}张手牌`);
    const marks = [];
    if (player.hero.state?.form) {
      const form = formNames[player.hero.state.form] ?? player.hero.state.form;
      marks.push(`<span class="hero-state-mark" title="${form}形态">${form}</span>`);
    }
    for (const [field, label, maximum, image] of heroMarkers[player.hero.id] ?? []) {
      const amount = player.hero.state?.[field] ?? 0;
      if (amount > 0) marks.push(`<span class="element-mark" data-hero-marker="${field}" title="${label} ${amount}/${maximum}" aria-label="${label} ${amount}/${maximum}"><img src="/assets/markers/${image}.png" alt="${label}"><b>${amount}</b></span>`);
    }
    node.classList.toggle("hero-transformed", !!player.hero.state?.form);
    if (player.getStatus("holyShield")[0]) marks.push('<img src="/assets/card/holyShield.png" title="圣盾" alt="圣盾">');
    if (player.getStatus("weakness")[0]) marks.push('<img src="/assets/card/weakness.png" title="虚弱" alt="虚弱">');
    if (player.getStatus("poison").length) marks.push(`<span class="poison-mark"><img src="/assets/card/poison.png" title="中毒" alt="中毒"><b>${player.getStatus("poison").length}</b></span>`);
    for (const card of player.statuses.filter(card => !["holyShield", "weakness", "poison"].includes(card.attachment.effectId))) {
      const id = card.attachment.effectId, label = UNIQUE_SKILL_NAMES[id] ?? CARD_NAMES[id] ?? id;
      marks.push(`<span class="poison-mark" data-effect-id="${id}"><img src="/assets/card/${card.name}.png" title="${label}" alt="${label}"><b>${label.startsWith("五") ? "" : label[0]}</b></span>`);
    }
    const energy = [
      ["crystal", "crystal", "水晶"], ["gem", "gem", "宝石"],
    ].filter(([kind]) => player.energy[kind] > 0).map(([kind, image, label]) => `<span><img src="/assets/stones/${image}.png" alt="${label}"><b>${player.energy[kind]}</b></span>`).join("");
    const revealed = revealHands ? `<div class="revealed-hand" aria-label="${player.name}的手牌">${player.hand.map(card => `<span class="revealed-card"><img data-hand-card-id="${card.id}" src="/assets/card/${card.name}.png" alt="${cardLabel(card, { game, playerId: player.id })}" title="${cardLabel(card, { game, playerId: player.id })}"><small class="revealed-fate" aria-hidden="true">${card.getTraits({ game, playerId: player.id }).fates.map(fate => FATE_NAMES[fate] ?? fate).join("/")}</small></span>`).join("")}</div>` : "";
    const markup = `<img class="avatar" src="/assets/character/${player.hero.portrait}.jpg" alt=""><span class="player-name" title="${player.name}；${player.hero.implemented || player.hero.skills?.length ? "已实现角色技能" : "角色技能尚未实现"}">${player.hero.name}</span><span class="identity"><span>${player.team === "red" ? "红" : "蓝"}</span></span><span class="count">${player.hand.length}/${player.handLimit}</span><span class="hp" title="治疗 ${player.healing}" aria-label="治疗 ${player.healing}">${Array.from({ length: Math.max(player.healing, game.getHealingLimit?.(player.id) ?? player.healingLimit ?? 2) }, (_, index) => index).reverse().map(index => `<span class="${index < player.healing ? "" : "lost"}"></span>`).join("")}</span><span class="energy" title="个人能量" style="top:${6 + marks.length * 28}px">${energy}</span><div class="marks">${marks.reverse().join("")}</div>${revealed}`;
    if (node._markup !== markup) { node.innerHTML = markup; node._markup = markup; }
    if (player.energy.gem + player.energy.crystal === 0) node.querySelector(".energy").hidden = true;

  }
}

export function renderHand(game, container, humanId, { acceptingAction, selectedCard, locked, onSelect, handChoice = null, restrictToLegal = false }) {
  const existing = new Map([...container.children].map(node => [node.dataset.cardId, node]));
  const activeIds = new Set(game.player(humanId).hand.map(card => card.id));
  for (const node of [...container.children]) if (!activeIds.has(node.dataset.cardId)) node.remove();
  for (const [index, card] of game.player(humanId).hand.entries()) {
    const button = existing.get(card.id) || document.createElement("button");
    button.dataset.cardId = card.id; button.dataset.index = index;
    const usable = handChoice ? handChoice.valid.includes(index) : game.legalTargets(humanId, card).length > 0;
    const selected = handChoice ? handChoice.selected.has(index) : selectedCard === index;
    button.className = `card${selected ? " selected" : ""}${usable ? "" : " unusable"}`;
    button.disabled = !acceptingAction || locked || ((handChoice || restrictToLegal) && !usable);
    const context = { game, playerId: humanId, purpose: "hand" };
    const markup = cardContents(card, context);
    if (button._markup !== markup) { button.innerHTML = markup; button._markup = markup; }
    button.title = cardLabel(card, context);
    button.setAttribute("aria-label", cardLabel(card, context));
    button.setAttribute("aria-pressed", String(selected));
    button.onclick = () => onSelect(Number(button.dataset.index));
    if (container.children[index] !== button) container.insertBefore(button, container.children[index] || null);
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
