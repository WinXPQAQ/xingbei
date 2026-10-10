// Isolated original-engine evidence. Runtime fixtures are labelled; source stays read-only.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.ORIGINAL_URL || "http://127.0.0.1:4180";
const output = resolve(process.argv[2] || `xingbei-cli/artifacts/frontend/restoration/original-${Date.now()}`);
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "run.json"), JSON.stringify({ base, seed: 20260905, fixtures: "Runtime only; card quantities, team resources and marks are prepared explicitly. Not natural-gameplay validation." }, null, 2), { flag: "wx" });
const browser = await chromium.launch({ headless: true, args: process.env.BROWSER_NO_SANDBOX === "1" ? ["--no-sandbox"] : [], ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const issues = [], captures = [];
async function capture(page, name, fixture = null) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(output, `${name}.png`), animations: "disabled" });
  const data = await page.evaluate(async () => {
    const { game, lib, _status, ui } = await import("/noname.js");
    const geometry = Object.fromEntries(["#arena", "#arena > .player", ".avatar", "#handcards1 .card", "#handcards1 .card > .info > span", "#control", ".zhanJi", ".zhanJi table", ".dialog:not(.hidden)", ".dialog:not(.hidden) .tdnode"].map(selector => [selector, [...document.querySelectorAll(selector)].map(node => {
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, text: node.innerText, className: node.className, style: Object.fromEntries(["fontFamily", "fontSize", "lineHeight", "padding", "width", "height", "display", "background", "borderCollapse", "borderSpacing", "boxSizing", "border", "textShadow"].map(key => [key, style[key]])) };
    })]));
    return { viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, config: Object.fromEntries(["theme", "layout", "ui_zoom", "touchscreen", "show_log", "show_history", "name_font", "identity_font"].map(key => [key, lib.config[key]])), documentZoom: game.documentZoom, deviceZoom: game.deviceZoom, event: { name: _status.event?.name, step: _status.event?.step }, geometry, selected: ui.selected.cards.length, players: game.players.map(player => ({ name: player.name, position: player.dataset.position, side: player.side, hand: player.getCards("h").map(card => ({ name: card.name, suit: card.suit, number: card.number })) })) };
  });
  await writeFile(resolve(output, `${name}.json`), JSON.stringify({ fixture, ...data }, null, 2));
  await writeFile(resolve(output, `${name}.html`), await page.content());
  captures.push(name);
}
async function handCount(page, count) {
  await page.evaluate(async count => {
    const { game, ui, _status } = await import("/noname.js");
    game.uncheck();
    const hand = game.me.getCards("h");
    while (hand.length > count) ui.cardPile.append(hand.pop());
    const added = [];
    while (hand.length + added.length < count) added.push(ui.cardPile.firstChild), ui.cardPile.firstChild.remove();
    if (added.length) game.me.directgain(added);
    game.me.update();
    delete _status.event._skillChoice;
    game.check(); ui.updatehl();
  }, count);
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "zh-CN", timezoneId: "UTC" });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("dialog", dialog => dialog.message().startsWith("欢迎来到《星杯传说》") ? dialog.accept() : dialog.dismiss());
  page.on("pageerror", error => issues.push({ type: "pageerror", text: error.message }));
  page.on("console", message => { if (message.type() === "error") issues.push({ type: "console", text: message.text() }); });
  page.on("response", response => { if (response.status() >= 400) issues.push({ type: "http", status: response.status(), url: response.url() }); });
  await page.addInitScript(() => { let seed = 20260905; Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32); });
  await page.goto(base);
  await page.getByText("跳过向导", { exact: true }).waitFor();
  await page.waitForTimeout(1200);
  await page.getByText("跳过向导", { exact: true }).click();
  await page.locator(".dialog .button.character").first().waitFor();
  await page.locator(".dialog .tdnode").first().click();
  await page.locator(".dialog .button.character").filter({ hasText: "狂战士" }).click();
  await page.waitForFunction(async () => { const { game, _status } = await import("/noname.js"); return game.me?.countCards("h") === 4 && _status.event?.name === "gongJiOrFaShu"; });
  await page.waitForTimeout(1200);
  await capture(page, "opening-1440x900");
  for (const viewport of [{ width: 1280, height: 720 }, { width: 844, height: 390 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(800);
    await capture(page, `opening-${viewport.width}x${viewport.height}`, "Same original game, resized; touchscreen remains false as in original desktop configuration.");
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(800);
  await page.locator("#handcards1 .card").first().click();
  await capture(page, "target-1440x900");
  await page.locator("#handcards1 .card").first().click();
  await capture(page, "target-cancel-1440x900");
  for (const count of [6, 8, 1, 0, 3]) {
    await handCount(page, count);
    await capture(page, `hand-${count}-1440x900`, `Prepared ${count} actual cards with original directgain/updatehl; no rule event executed.`);
  }
  await page.evaluate(async () => {
    const { game, ui, _status } = await import("/noname.js");
    const key = game.me.side ? "hongZhanJi" : "lanZhanJi";
    game[key] = ["baoShi", "baoShi", "shuiJing", "shuiJing"];
    ui.updateShiQiInfo(); delete _status.event._skillChoice; game.uncheck(); game.check();
  });
  await page.getByText("合成", { exact: true }).click();
  await page.getByText("合成：选择星石", { exact: true }).waitFor();
  await capture(page, "synthesize-1440x900", "Prepared 3-card hand and 4 team stones; opened actual original synthesis selection through its skill button.");
  await page.locator("#control").getByText("取消", { exact: true }).click();
  await page.getByText("提炼", { exact: true }).click();
  await page.getByText("提炼：选择星石", { exact: true }).waitFor();
  await capture(page, "refine-1440x900", "Prepared team stones; opened actual original refinement selection through its skill button.");
  await page.locator("#control").getByText("取消", { exact: true }).click();
  await page.evaluate(async () => {
    const { game } = await import("/noname.js");
    const player = game.players.find(player => player !== game.me && player.dataset.position === "2");
    for (const skill of ["_shengDun", "_xuRuo", "_zhongDu"]) player.markSkill(skill);
    game.me.addMark("_tiLian_baoShi", 1); game.me.addMark("_tiLian_shuiJing", 1);
  });
  await capture(page, "statuses-1440x900", "Original markSkill/addMark UI only; does not validate the underlying status rules.");
  await page.evaluate(async () => { const { game } = await import("/noname.js"); game.over(true); });
  await capture(page, "end-1440x900", "Called original game.over(true) in isolated fixture; victory conditions not exercised.");
} finally {
  await writeFile(resolve(output, "results.json"), JSON.stringify({ browser: browser.version(), captures, issues }, null, 2));
  await browser.close();
}
console.log(`Saved ${captures.length} original captures to ${output}`);
