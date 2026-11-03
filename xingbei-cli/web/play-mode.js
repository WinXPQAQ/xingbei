// A session-bound gate pauses rule/presentation checkpoints even with motion off.
export class PlaybackGate {
  constructor() { this.paused = false; this.waiters = new Set(); }
  setPaused(value) {
    this.paused = value;
    if (!value) for (const resume of [...this.waiters]) resume();
  }
  async wait(session) {
    session.assert();
    while (this.paused) await session.wait(resolve => {
      this.waiters.add(resolve);
      return () => this.waiters.delete(resolve);
    });
    session.assert();
  }
}

export function createModeControls(container, onCommand) {
  const panel = document.createElement("nav");
  panel.hidden = true; panel.className = "play-mode-controls"; panel.setAttribute("aria-label", "游玩模式控制");
  for (const [command, label, mode] of [
    ["draw", "摸1张牌", "test"], ["discard", "弃一张牌", "test"],
    ["red-plus", "红方士气+1", "test"], ["red-minus", "红方士气−1", "test"],
    ["blue-plus", "蓝方士气+1", "test"], ["blue-minus", "蓝方士气−1", "test"],
    ["pause", "暂停", "spectate"], ["next-turn", "推进下一回合", "developer"],
  ]) {
    const button = document.createElement("button");
    button.dataset.command = command; button.dataset.mode = mode; button.textContent = label;
    button.onclick = () => onCommand(command); panel.append(button);
  }
  const controlled = document.createElement("span"); controlled.className = "controlled-seat"; panel.prepend(controlled);
  container.append(panel);
  return { update(mode, { ready, editable, hasCards, paused, morale, controlled: label }) {
    panel.hidden = mode === "normal" || !ready;
    controlled.hidden = mode !== "developer"; controlled.textContent = `正在控制：${label}`;
    for (const button of panel.querySelectorAll("button")) {
      button.hidden = button.dataset.mode !== mode && !(mode === "developer" && button.dataset.mode === "test");
      button.disabled = ["test", "developer"].includes(mode) && (!editable || (button.dataset.command === "discard" && !hasCards) || (button.dataset.command.endsWith("-plus") && morale[button.dataset.command.split("-")[0]] >= 15));
      if (button.dataset.command === "pause") { button.textContent = paused ? "继续" : "暂停"; button.setAttribute("aria-pressed", String(paused)); }
    }
  } };
}
