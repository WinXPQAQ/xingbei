// Original $draw/$throwordered2/linexy/$damage adapted without the old engine.
import { cardContents } from "/web/render.js";
import { CARD_NAMES } from "/src/cards.js";

let assetPromise;
export function preloadAnimationAssets() {
  assetPromise ??= Promise.all([...Object.keys(CARD_NAMES).map(name => `/assets/card/${name}.png`), "/theme/cardback.png", "/assets/stones/gem.png", "/assets/stones/crystal.png"].map(src => {
    const image = new Image(); image.src = src;
    return image.decode();
  }));
  return assetPromise;
}

export function presentationView(snapshot, game) {
  const card = data => ({ ...data, getTraits: () => ({ elements: data.elements, fates: data.fates }) });
  const players = snapshot.players.map(data => ({ ...data, hand: data.hand.map(card),
    getStatus: id => data.statuses.filter(item => item.attachment?.effectId === id) }));
  return { ...snapshot, players, deck: { length: snapshot.deckCount }, discard: { length: snapshot.discardCount },
    player: id => players[id], legalTargets: (id, data) => game.legalTargets(id, game.cards.get(data.id)),
    canDrawSpecial: id => players[id].hand.length <= 3,
    stoneCounts: team => ({ gem: snapshot.teams[team].achievements.filter(kind => kind === "gem").length,
      crystal: snapshot.teams[team].achievements.filter(kind => kind === "crystal").length, total: snapshot.teams[team].achievements.length }) };
}

export class AnimationDirector {
  constructor(arena, session, { mode = "normal" } = {}) {
    this.arena = arena; this.session = session; this.mode = mode;
    this.origins = new Map(); this.paused = false; this.resume = null;
    this.active = new Set(); this.table = []; this.trace = []; this.playing = false;
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)");
    this.layer = document.createElement("div"); this.layer.className = "animation-layer";
    this.layer.setAttribute("aria-hidden", "true"); arena.append(this.layer);
    this.onVisibility = () => { if (document.hidden) { this.pause(false); this.finish(); } };
    this.onResize = () => this.finish();
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("resize", this.onResize);
  }
  get mode() { return this._mode; }
  set mode(value) { this._mode = value; this.arena.dataset.motion = value; }
  get instant() { return this.mode === "off" || this.reduced.matches || document.hidden; }
  dispose() {
    this.finish(); this.layer.remove();
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("resize", this.onResize);
  }
  finish() { for (const animation of this.active) animation.finish(); }
  pause(value) {
    this.paused = value;
    for (const animation of this.active) value ? animation.pause() : animation.play();
    if (!value) this.resume?.();
  }
  step() {
    this.paused = true;
    if (this.active.size) this.finish(); else this.resume?.();
  }
  captureHand() {
    this.origins.clear();
    for (const node of this.arena.querySelectorAll("#hand .card")) this.origins.set(node.dataset.cardId, this.point(node));
  }
  point(node) {
    const arena = this.arena.getBoundingClientRect(), rect = node?.getBoundingClientRect() || arena;
    const sx = arena.width / this.arena.offsetWidth, sy = arena.height / this.arena.offsetHeight;
    return { x: (rect.x + rect.width / 2 - arena.x) / sx, y: (rect.y + rect.height / 2 - arena.y) / sy };
  }
  player(id) { return this.arena.querySelector(`[data-player="${id}"]`); }
  center() { return { x: this.arena.offsetWidth / 2, y: this.arena.offsetHeight / 2 }; }
  place(node, point) { node.style.left = `${point.x}px`; node.style.top = `${point.y}px`; }
  clone(card, face = true) {
    const node = document.createElement("div"); node.className = `card animation-card${face ? "" : " card-back"}`;
    node.dataset.cardId = card.id;
    if (face) node.innerHTML = cardContents({ ...card, getTraits: () => ({ elements: card.elements, fates: card.fates }) });
    this.layer.append(node); return node;
  }
  animate(node, frames, duration, { remove = false, easing = "ease-in-out" } = {}) {
    if (this.instant) { if (remove) node.remove(); return Promise.resolve(); }
    return this.session.wait(resolve => {
      const animation = node.animate(frames, { duration, easing, fill: "forwards" });
      this.active.add(animation);
      animation.finished.then(() => resolve(), () => {}).catch(() => {});
      return () => { this.active.delete(animation); animation.cancel(); if (remove) node.remove(); };
    });
  }
  async travel(node, from, to, duration = 500, remove = false) {
    this.place(node, to);
    await this.animate(node, [
      { transform: `translate(-50%, -50%) translate(${from.x - to.x}px, ${from.y - to.y}px)`, opacity: .65 },
      { transform: "translate(-50%, -50%)", opacity: 1 },
    ], duration, { remove });
  }
  async popup(point, text, kind = "") {
    const node = document.createElement("div"); node.className = `animation-popup ${kind}`;
    node.textContent = text; this.layer.append(node); this.place(node, point);
    await this.animate(node, [
      { transform: "translate(-50%, -20%) scale(.75)", opacity: 0 },
      { transform: "translate(-50%, -60%) scale(1)", opacity: 1, offset: .25 },
      { transform: "translate(-50%, -100%) scale(1)", opacity: 0 },
    ], 700, { remove: true });
  }
  async line(source, target) {
    if (this.instant) return;
    const from = this.point(this.player(source)), to = this.point(this.player(target));
    const node = document.createElement("div"); node.className = "animation-line";
    const dx = to.x - from.x, dy = to.y - from.y;
    node.style.width = `${Math.hypot(dx, dy)}px`;
    this.place(node, from); node.style.rotate = `${Math.atan2(dy, dx)}rad`; this.layer.append(node);
    await this.animate(node, [{ transform: "scaleX(0)", opacity: 0 },
      { transform: "scaleX(1)", opacity: 1, offset: .45 }, { transform: "scaleX(1)", opacity: 0 }], 1000, { remove: true });
  }
  closeDialog(dialog) {
    if (this.session.cancelled || this.instant || dialog.hidden) return;
    const copy = dialog.cloneNode(true), point = this.point(dialog);
    copy.className = "animation-dialog-exit"; copy.inert = true;
    copy.removeAttribute("id"); for (const node of copy.querySelectorAll("[id]")) node.removeAttribute("id");
    const rect = dialog.getBoundingClientRect(), scale = this.arena.getBoundingClientRect().width / this.arena.offsetWidth;
    copy.style.width = `${rect.width / scale}px`; copy.style.height = `${rect.height / scale}px`;
    this.layer.append(copy); this.place(copy, point);
    void this.animate(copy, [{ opacity: 1, transform: "translate(-50%, -50%)" }, { opacity: 0, transform: "translate(-50%, -45%)" }], 140, { remove: true }).catch(() => {});
  }
  async clear() {
    const nodes = this.table.splice(0);
    await Promise.all(nodes.map(node => this.animate(node, [{ opacity: 1 }, { opacity: 0, transform: "translate(-50%, -45%)" }], 250, { remove: true })));
  }
  async show(event, render) {
    this.session.assert(); this.playing = true;
    if (this.paused && !this.instant) await this.session.wait(resolve => { this.resume = resolve; return () => { this.resume = null; }; });
    const entry = { ...event }; delete entry.view;
    this.trace.push({ ...entry, status: "started", at: performance.now() });
    this.trace = this.trace.slice(-300);
    try {
      const point = this.point(this.player(event.playerId));
      if (event.type === "move") {
        const from = event.from.zone === "hand" && event.from.playerId === 0
          ? this.origins.get(event.card.id) || this.point(this.arena.querySelector(`[data-card-id="${event.card.id}"]`) || this.player(0))
          : event.from.playerId != null ? this.point(this.player(event.from.playerId)) : this.center();
        this.origins.delete(event.card.id);
        const face = event.visibility !== "hidden" && (event.to.zone !== "hand" || event.to.playerId === 0);
        const previous = this.table.find(node => node.dataset.cardId === event.card.id);
        if (previous && event.to.zone === "status") {
          this.table = this.table.filter(node => node !== previous); previous.remove();
        }
        const node = this.clone(event.card, face);
        if (event.to.zone === "status") {
          const transit = structuredClone(event.view);
          transit.players[event.to.playerId].statuses = transit.players[event.to.playerId].statuses.filter(card => card.id !== event.card.id);
          render(transit);
          await this.travel(node, from, this.center(), 500);
          await this.travel(node, this.center(), this.point(this.player(event.to.playerId)), 400, true);
          render(event.view);
        } else if (event.to.zone === "discard" || event.to.zone === "field") {
          render(event.view);
          if (this.table.length >= 4) await this.clear();
          this.table.push(node);
          const center = this.center();
          const movement = Promise.all(this.table.map((card, index) => this.travel(card, card === node ? from : this.point(card),
            { x: center.x + (index - (this.table.length - 1) / 2) * 114, y: center.y }, 500)));
          await Promise.all([movement, event.targetId != null && event.card.type === "attack" ? this.line(event.from.playerId, event.targetId) : Promise.resolve()]);
        } else { node.remove(); }
      } else if (event.type === "cleanup") {
        render(event.view);
        await this.clear();
      } else if (event.type === "draw") {
        const nodes = event.cards.map(card => this.clone(card, event.playerId === 0));
        render(event.view);
        const arrivals = event.playerId === 0 ? event.cards.map(card => this.arena.querySelector(`#hand [data-card-id="${card.id}"]`)) : [];
        for (const node of arrivals) if (node) node.style.visibility = "hidden";
        try {
          await Promise.all(nodes.map((node, index) => this.travel(node,
            { ...this.center(), x: this.center().x + (index - (nodes.length - 1) / 2) * 24 },
            arrivals[index] ? this.point(arrivals[index]) : { x: point.x + (index - (nodes.length - 1) / 2) * 20, y: point.y }, 800, true)));
        } finally { for (const node of arrivals) if (node) node.style.visibility = ""; }
      } else if (event.type === "discard") {
        const cards = event.cards.map(card => ({ card, from: event.playerId === 0
          ? this.origins.get(card.id) || this.point(this.arena.querySelector(`[data-card-id="${card.id}"]`) || this.player(0)) : point }));
        this.origins.clear();
        render(event.view);
        await Promise.all(cards.map(({ card, from }, index) => {
          const node = this.clone(card, event.visibility !== "hidden"); this.table.push(node);
          return this.travel(node, from, { x: this.center().x + (index - (cards.length - 1) / 2) * Math.min(114, 400 / cards.length), y: this.center().y }, 500);
        }));
      } else {
        render(event.view);
        if (event.type === "relay") await this.line(event.sourceId, event.playerId);
        if (event.type === "damage") {
          const avatar = this.player(event.playerId)?.querySelector(".avatar");
          if (event.amount && avatar && !this.instant) {
            const source = this.point(this.player(event.sourceId));
            const length = Math.hypot(point.x - source.x, point.y - source.y) || 1;
            const dx = (point.x - source.x) * 15 / length, dy = (point.y - source.y) * 15 / length;
            await Promise.all([this.animate(avatar, [{ transform: "translate(0,0)" }, { transform: `translate(${dx}px,${dy}px)`, offset: .3 }, { transform: "translate(0,0)" }], 400), this.popup(point, String(event.amount), "damage")]);
          } else if (event.amount) await this.popup(point, String(event.amount), "damage");
        }
        if (event.type === "effect") await this.popup(point, CARD_NAMES[event.effectId] || event.effectId, "effect");
        if (event.type === "miss") await this.popup(point, event.cause === "holyLight" ? "圣光 · 未命中" : "圣盾 · 未命中", "protection");
        if (event.type === "turn") {
          const avatar = this.player(event.playerId)?.querySelector(".avatar");
          if (avatar) await this.animate(avatar, [{ transform: "scale(1)" }, { transform: "scale(1.05)", offset: .4 }, { transform: "scale(1)" }], 400);
        }
        if (event.type === "morale" || event.type === "stones" || event.type === "cup") {
          const team = document.querySelector(`#${event.team}-team`);
          const label = event.type === "morale" ? "士气" : event.type === "cup" ? "星杯" : "星石";
          const feedback = this.popup(this.point(team), `${label} ${event.amount > 0 ? "+" : ""}${event.amount}`, event.type === "cup" ? "protection" : "resource");
          const tokens = [];
          if (event.type === "stones" && event.amount > 0) {
            for (let i = 0; i < event.amount; i++) {
              const token = document.createElement("img"); token.className = "animation-token"; token.src = `/assets/stones/${event.kind}.png`;
              this.layer.append(token); tokens.push(this.travel(token, this.center(), this.point(team), 450, true));
            }
          }
          await Promise.all([feedback, ...tokens]);
        }
        if (event.type === "energy") {
          const tokens = [];
          const team = document.querySelector(`#${event.view.players[event.playerId].team}-team`);
          for (const kind of ["gem", "crystal"]) for (let i = 0; i < event[kind]; i++) {
            const token = document.createElement("img"); token.className = "animation-token"; token.src = `/assets/stones/${kind}.png`;
            this.layer.append(token); tokens.push(this.travel(token, this.point(team), point, 450, true));
          }
          await Promise.all([this.popup(point, `${event.gem + event.crystal < 0 ? "消耗" : "提炼"} ${Math.abs(event.gem + event.crystal)}`, "resource"), ...tokens]);
        }
        if (event.type === "winner") await this.popup(this.center(), `${event.team === "red" ? "红方" : "蓝方"}获胜`, "protection");
        if (["skill", "extraAction"].includes(event.type)) await this.popup(point, event.label, "protection");
        if (event.type === "healing") await this.popup(point, `治疗 ${event.amount}`, "protection");
        if (event.type === "shuffle") await this.popup(this.center(), "洗牌", "resource");
        if (event.type === "clear") await this.clear();
      }
      this.session.assert();
      this.trace.push({ sequence: event.sequence, type: event.type, status: "finished", at: performance.now() });
    } finally { this.playing = false; }
  }
}
