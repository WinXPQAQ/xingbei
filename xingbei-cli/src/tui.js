import readline from "node:readline";

const ESC = "\x1b[";

function crop(text, width) {
  const value = String(text);
  let result = "";
  let used = 0;
  for (const character of value) {
    const size = characterWidth(character);
    if (used + size > width) break;
    result += character;
    used += size;
  }
  if (used < displayWidth(value) && width > 0) {
    while (used + 1 > width && result) {
      const characters = [...result];
      used -= characterWidth(characters.pop());
      result = characters.join("");
    }
    result += "…";
    used++;
  }
  return result + " ".repeat(Math.max(0, width - used));
}

function displayWidth(value) {
  return [...String(value)].reduce((sum, character) => sum + characterWidth(character), 0);
}

function characterWidth(character) {
  const code = character.codePointAt(0);
  return code >= 0x1100 && (
    code <= 0x115f || code === 0x2329 || code === 0x232a ||
    (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe10 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6)
  ) ? 2 : 1;
}

export class TerminalUI {
  constructor({ input = process.stdin, output = process.stdout } = {}) {
    this.input = input;
    this.output = output;
    this.interactive = Boolean(input.isTTY && output.isTTY);
    this.stateLines = [];
    this.consoleLines = [];
    this.actionLines = [];
    this.scroll = { console: 0, actions: 0 };
    this.focus = "console";
    this.promptText = "";
    this.buffer = "";
    this.cursor = 0;
    this.history = [];
    this.historyIndex = 0;
    this.pending = null;

    if (this.interactive) {
      readline.emitKeypressEvents(input);
      input.setRawMode(true);
      input.resume();
      this.keyHandler = (text, key) => this.onKey(text, key);
      this.resizeHandler = () => this.render();
      input.on("keypress", this.keyHandler);
      output.on("resize", this.resizeHandler);
      output.write("\x1b[?1049h\x1b[?25h");
    } else {
      this.lineReader = readline.createInterface({ input, output });
      this.lines = this.lineReader[Symbol.asyncIterator]();
    }
  }

  setState(lines) {
    this.stateLines = lines;
    if (!this.interactive) this.output.write(`${lines.join("\n")}\n`);
    this.render();
  }

  console(message = "") {
    this.pushLines(this.consoleLines, message);
  }

  actions(message = "") {
    this.pushLines(this.actionLines, message);
  }

  pushLines(target, message) {
    target.push(...String(message).split("\n"));
    if (target.length > 1000) target.splice(0, target.length - 1000);
    const panel = target === this.consoleLines ? "console" : "actions";
    this.scroll[panel] = 0;
    if (!this.interactive) this.output.write(`${message}\n`);
    this.render();
  }

  async question(prompt) {
    this.promptText = prompt;
    this.buffer = "";
    this.cursor = 0;
    this.historyIndex = this.history.length;
    this.render();
    if (!this.interactive) {
      this.output.write(prompt);
      const next = await this.lines.next();
      return next.done ? "quit" : next.value;
    }
    return new Promise(resolve => { this.pending = resolve; });
  }

  onKey(text, key = {}) {
    if (key.ctrl && key.name === "c") return this.finishQuestion("quit");
    if (key.name === "tab") {
      this.focus = this.focus === "console" ? "actions" : "console";
      return this.render();
    }
    if (key.name === "pageup" || key.name === "pagedown") {
      const amount = Math.max(1, this.panelHeight() - 2);
      this.scrollPanel(key.name === "pageup" ? amount : -amount);
      return;
    }
    if (!this.pending) {
      if (key.name === "up") this.scrollPanel(1);
      else if (key.name === "down") this.scrollPanel(-1);
      return;
    }
    if (key.name === "return") return this.finishQuestion(this.buffer);
    if (key.name === "escape") return this.finishQuestion("");
    if (key.name === "left") this.cursor = Math.max(0, this.cursor - 1);
    else if (key.name === "right") this.cursor = Math.min(this.buffer.length, this.cursor + 1);
    else if (key.name === "home") this.cursor = 0;
    else if (key.name === "end") this.cursor = this.buffer.length;
    else if (key.name === "backspace") {
      if (this.cursor > 0) {
        this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
        this.cursor--;
      }
    } else if (key.name === "delete") {
      this.buffer = this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1);
    } else if (key.name === "up" || key.name === "down") {
      this.recallHistory(key.name === "up" ? -1 : 1);
    } else if (text && !key.ctrl && !key.meta && text >= " ") {
      this.buffer = this.buffer.slice(0, this.cursor) + text + this.buffer.slice(this.cursor);
      this.cursor += text.length;
    }
    this.render();
  }

  recallHistory(delta) {
    if (!this.history.length) return;
    this.historyIndex = Math.max(0, Math.min(this.history.length, this.historyIndex + delta));
    this.buffer = this.historyIndex === this.history.length ? "" : this.history[this.historyIndex];
    this.cursor = this.buffer.length;
  }

  finishQuestion(value) {
    if (!this.pending) return;
    if (value.trim()) this.history.push(value);
    const resolve = this.pending;
    this.pending = null;
    this.promptText = "";
    this.console(`> ${value}`);
    resolve(value);
  }

  scrollPanel(delta) {
    const lines = this.focus === "console" ? this.consoleLines : this.actionLines;
    this.scroll[this.focus] = Math.max(0, Math.min(Math.max(0, lines.length - 1), this.scroll[this.focus] + delta));
    this.render();
  }

  dimensions() {
    return { width: Math.max(60, this.output.columns || 100), height: Math.max(20, this.output.rows || 30) };
  }

  panelHeight() {
    const { height } = this.dimensions();
    return Math.max(5, height - Math.min(10, this.stateLines.length + 2) - 3);
  }

  visible(lines, height, offset) {
    const end = Math.max(0, lines.length - offset);
    return lines.slice(Math.max(0, end - height), end);
  }

  render() {
    if (!this.interactive) return;
    const { width, height } = this.dimensions();
    const stateHeight = Math.min(height - 8, Math.max(3, this.stateLines.length + 2));
    const panelsHeight = height - stateHeight - 2;
    const leftWidth = Math.max(28, Math.floor(width * 0.58));
    const rightWidth = width - leftWidth - 1;
    const out = ["\x1b[2J\x1b[H"];
    out.push(`${ESC}1;36m┌ 状态${"─".repeat(Math.max(0, width - 7))}┐${ESC}0m`);
    for (let row = 0; row < stateHeight - 2; row++) out.push(`\n${crop(this.stateLines[row] || "", width)}`);
    out.push(`\n${"─".repeat(width)}`);

    const left = this.visible(this.consoleLines, panelsHeight, this.scroll.console);
    const right = this.visible(this.actionLines, panelsHeight, this.scroll.actions);
    const leftColor = this.focus === "console" ? `${ESC}1;33m` : `${ESC}2m`;
    const rightColor = this.focus === "actions" ? `${ESC}1;33m` : `${ESC}2m`;
    out.push(`\n${leftColor}控制台${ESC}0m${" ".repeat(Math.max(0, leftWidth - 6))}│${rightColor}行动日志${ESC}0m`);
    for (let row = 0; row < panelsHeight - 1; row++) {
      out.push(`\n${crop(left[row] || "", leftWidth)}│${crop(right[row] || "", rightWidth)}`);
    }
    const inputLine = `${this.promptText}${this.buffer}`;
    out.push(`\n${ESC}7m${crop(inputLine, width)}${ESC}0m`);
    this.output.write(out.join(""));
    const inputRow = height;
    const inputColumn = Math.min(width, displayWidth(this.promptText) + displayWidth(this.buffer.slice(0, this.cursor)) + 1);
    this.output.write(`${ESC}${inputRow};${inputColumn}H`);
  }

  close() {
    if (this.interactive) {
      this.input.off("keypress", this.keyHandler);
      this.output.off("resize", this.resizeHandler);
      this.input.setRawMode(false);
      this.output.write("\x1b[?1049l\x1b[?25h");
    } else this.lineReader?.close();
  }
}

export async function askIndex(ui, prompt, validIndexes, { allowBlank = true } = {}) {
  while (true) {
    const answer = (await ui.question(prompt)).trim();
    if (allowBlank && answer === "") return null;
    const value = Number(answer);
    if (/^\d+$/.test(answer) && validIndexes.includes(value)) return value;
    ui.console(`输入无效，请选择：${validIndexes.join("、")}${allowBlank ? "，或直接回车取消" : ""}`);
  }
}
