// Six-player layout evidence in an isolated original-engine browser profile.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.ORIGINAL_URL || "http://127.0.0.1:4180";
const output = resolve(process.argv[2] || "xingbei-cli/artifacts/frontend/restoration/2026-10-10/animation-original");
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "run.json"), JSON.stringify({ base, players: 6, fixture: "Isolated 3v3 configuration; runtime team labels aligned to red-blue-blue-red-red-blue for geometry comparison. Not natural rules validation." }), { flag: "wx" });
const browser = await chromium.launch({ headless: true, args: process.env.BROWSER_NO_SANDBOX === "1" ? ["--no-sandbox"] : [], ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const issues = [];
let page;
try {
  page = await browser.newPage({ recordVideo: { dir: output }, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "zh-CN", timezoneId: "UTC" });
  page.setDefaultTimeout(15000);
  page.on("dialog", dialog => dialog.message().startsWith("欢迎来到《星杯传说》") ? dialog.accept() : dialog.dismiss());
  page.on("pageerror", error => issues.push(error.stack));
  page.on("response", response => { if (response.status() >= 400) issues.push({ url: response.url(), status: response.status() }); });
  await page.addInitScript(() => {
    let seed = 20260905;
    Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  });
  await page.goto(base);
  await page.getByText("跳过向导", { exact: true }).waitFor();
  // Original onfree() initializes appearance/menu defaults asynchronously.
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    const { game } = await import("/noname.js");
    await new Promise(resolve => game.saveConfig("versus_mode", "three", "xingBei", resolve));
    await new Promise(resolve => game.saveConfig("team_sequence", "random", "xingBei", resolve));
    await new Promise(resolve => game.saveConfig("choose_mode", "多选1", "xingBei", resolve));
    await new Promise(resolve => game.saveConfig("choose_number", 99, "xingBei", resolve));
    await new Promise(resolve => game.saveConfig("change_identity", true, "xingBei", resolve));
  });
  await page.getByText("跳过向导", { exact: true }).click();
  await page.locator(".dialog .button.character").first().waitFor();
  await page.locator(".dialog .tdnode").first().click();
  await page.locator(".dialog .button.character").filter({ hasText: "狂战士" }).click();
  await page.waitForFunction(async () => {
    const { game, _status } = await import("/noname.js");
    return game.players.length === 6 && game.me.countCards("h") === 4 && _status.event?.name === "gongJiOrFaShu";
  });
  await page.evaluate(async () => {
    const { game } = await import("/noname.js");
    for (const player of game.players) {
      player.side = [true, false, false, true, true, false][Number(player.dataset.position)];
      player.node.identity.firstChild.innerHTML = player.side ? "红" : "蓝";
    }
  });
  await page.evaluate(async () => {
    const { game } = await import("/noname.js");
    window.animationCalls = [];
    for (const player of game.players) for (const name of ["$draw", "$throw", "$give", "$damage", "$damagepop", "line"]) {
      const original = player[name];
      player[name] = function (...args) {
        window.animationCalls.push({ method: name, player: this.dataset.position, at: performance.now() });
        return original.apply(this, args);
      };
    }
  });
  await page.locator("#handcards1 .card").first().click();
  await page.locator("#arena > .player.selectable").first().click();
  const confirm = page.locator("#control .control").filter({ hasText: "确定" });
  if (await confirm.count()) await confirm.first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: resolve(output, "natural-first-action.png") });
  await writeFile(resolve(output, "natural-calls.json"), JSON.stringify(await page.evaluate(() => window.animationCalls), null, 2));
  await page.evaluate(async () => { const { game, ui } = await import("/noname.js"); game.pause(); ui.clear(); });
  const probes = ["draw", "throw", "line", "damage", "phase"];
  const samples = [];
  for (const probe of probes) {
    await page.evaluate(async probe => {
      const { game, ui } = await import("/noname.js");
      ui.clear();
      const target = game.players.find(player => player.dataset.position === "1");
      if (probe === "draw") target.$draw(3);
      if (probe === "throw") game.me.$throw(game.me.getCards("h").slice(0, 2));
      if (probe === "line") game.me.line(target);
      if (probe === "damage") { target.$damage(game.me); target.$damagepop(2); }
      if (probe === "phase") target.$damage(null, "phase");
    }, probe);
    for (const wait of [0, 150, 350, 500]) {
      await page.waitForTimeout(wait);
      await page.screenshot({ path: resolve(output, `${probe}-${wait}.png`) });
      samples.push(await page.evaluate(probe => ({ probe, at: performance.now(), nodes: [...document.querySelectorAll(".thrown,.linexy,.damage,#arena > .player")].map(node => ({ className: node.className, rect: node.getBoundingClientRect().toJSON(), transform: getComputedStyle(node).transform, duration: getComputedStyle(node).transitionDuration, opacity: getComputedStyle(node).opacity })) }), probe));
    }
    await page.waitForTimeout(900);
  }
  await writeFile(resolve(output, "samples.json"), JSON.stringify({ fixture: "Isolated calls to original presentation methods, not natural gameplay acceptance", samples }, null, 2));
} finally {
  await writeFile(resolve(output, "issues.json"), JSON.stringify(issues, null, 2)); await browser.close();
}
console.log("原版动画录像与关键帧已保存（隔离呈现调用）。");
