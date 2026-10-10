// Six-player layout evidence in an isolated original-engine browser profile.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.ORIGINAL_URL || "http://127.0.0.1:4180";
const output = resolve(process.argv[2] || "xingbei-cli/artifacts/frontend/restoration/2026-10-10/six-original");
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "run.json"), JSON.stringify({ base, players: 6, fixture: "Isolated 3v3 configuration; runtime team labels aligned to red-blue-blue-red-red-blue for geometry comparison. Not natural rules validation." }), { flag: "wx" });
const browser = await chromium.launch({ headless: true, args: process.env.BROWSER_NO_SANDBOX === "1" ? ["--no-sandbox"] : [], ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const issues = [];
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "zh-CN", timezoneId: "UTC" });
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
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 844, height: 390 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport); await page.waitForTimeout(900);
    await page.evaluate(() => document.fonts.ready);
    const tag = `${viewport.width}x${viewport.height}`;
    await page.screenshot({ path: resolve(output, `opening-${tag}.png`), animations: "disabled" });
    const data = await page.evaluate(async () => {
      const { game, lib } = await import("/noname.js");
      const geometry = Object.fromEntries(["#arena", "#arena > .player", ".avatar", "#handcards1 .card", ".zhanJi"].map(selector => [selector, [...document.querySelectorAll(selector)].sort((a, b) => Number(a.closest(".player")?.dataset.position || 0) - Number(b.closest(".player")?.dataset.position || 0)).map(node => {
        const rect = node.getBoundingClientRect();
        return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, position: node.closest(".player")?.dataset.position };
      })]));
      return { viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, geometry, documentZoom: game.documentZoom, config: Object.fromEntries(["theme", "layout", "ui_zoom", "player_height_nova", "touchscreen", "show_log", "show_history"].map(key => [key, lib.config[key]])), mode: lib.config.mode_config.xingBei.versus_mode, players: game.players.map(player => ({ position: player.dataset.position, side: player.side, name: player.name })) };
    });
    await writeFile(resolve(output, `opening-${tag}.json`), JSON.stringify(data, null, 2));
    await writeFile(resolve(output, `opening-${tag}.html`), await page.content());
  }
} catch (error) {
  await page?.screenshot({ path: resolve(output, "failure.png") });
  if (page) await writeFile(resolve(output, "failure.html"), await page.content());
  throw error;
} finally {
  await writeFile(resolve(output, "issues.json"), JSON.stringify(issues, null, 2)); await browser.close();
}
console.log("原版六人四视口布局证据已保存。");
