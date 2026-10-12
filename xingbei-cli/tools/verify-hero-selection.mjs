import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getAvailableHeroes, createHeroRoster } from "../src/hero.js";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const output = resolve(process.argv[2] || "xingbei-cli/artifacts/heroes/selection");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const checks = [], issues = [], heroes = getAvailableHeroes();
const check = (label, value) => { assert.ok(value, label); checks.push(label); };
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, hasTouch: viewport.width < 500 });
    await page.addInitScript(() => { Date.now = () => 13; });
    page.on("pageerror", error => issues.push(error.message));
    page.on("console", message => { if (message.type() === "error") issues.push(message.text()); });
    page.on("response", response => { if (response.status() >= 400) issues.push(response.url()); });
    await page.goto("http://127.0.0.1:4173/?motion=off");
    const tag = `${viewport.width}x${viewport.height}`;
    await page.getByRole("heading", { name: "选择角色" }).waitFor();
    check(`${tag} 选择前不发牌`, await page.locator("#hand .card").count() === 0);
    check(`${tag} 六个角色可选择`, await page.locator("#modal-actions button").count() === 6);
    await page.screenshot({ path: resolve(output, `selection-${tag}.png`) });
    // Restart while a choice is pending must cancel the old selection session.
    await page.getByRole("button", { name: "重新开始", exact: true }).click();
    for (const hero of heroes) {
      await page.getByRole("heading", { name: "选择角色" }).waitFor();
      await page.getByRole("button", { name: hero.name, exact: true }).click();
      await page.waitForFunction(() => document.querySelector("#hint").textContent.includes("[攻击行动]"));
      check(`${tag} ${hero.name}坐到玩家位置`, await page.locator('.player[data-player="0"] .player-name').textContent() === hero.name);
      const names = createHeroRoster(hero.id).map(id => heroes.find(hero => hero.id === id).name);
      check(`${tag} ${hero.name}交换阵容且正常发牌`, (await page.locator(".player-name").allTextContents()).join() === names.join() && await page.locator("#hand .card").count() === 4);
      check(`${tag} ${hero.name}坐次保持`, (await page.locator(".player").evaluateAll(nodes => nodes.map(node => node.dataset.team))).join() === "red,blue,blue,red,red,blue");
      if (hero.id === "guardianAngel") await page.screenshot({ path: resolve(output, `angel-${tag}.png`) });
      await page.getByRole("button", { name: "重新开始", exact: true }).click();
    }
    await page.close();
  }
  check("控制台及素材错误0", issues.length === 0);
} finally { await writeFile(resolve(output, "results.json"), JSON.stringify({ checks, issues }, null, 2)); await browser.close(); }
console.log(`角色选择：${checks.length}项浏览器检查通过`);
