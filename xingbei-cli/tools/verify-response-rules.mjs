// Regression for empty responses and hidden overflow; keeps six-player seats.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.CURRENT_URL || "http://127.0.0.1:4173";
const output = resolve(process.argv[2] || "xingbei-cli/artifacts/frontend/restoration/2026-10-10/response-rules");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const checks = [], issues = [];
const check = (name, value) => { assert.ok(value, name); checks.push(name); };
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const tag = `${viewport.width}x${viewport.height}`;
    const page = await browser.newPage({ viewport, hasTouch: viewport.width < 500 });
    page.on("pageerror", error => issues.push(error.message));
    page.on("console", message => { if (message.type() === "error") issues.push(message.text()); });
    page.on("response", response => { if (response.status() >= 400) issues.push(response.url()); });
    const state = () => page.evaluate(() => window.xingbeiDev.exportState());
    const settled = () => page.waitForFunction(() => !window.xingbeiDev.animations().playing && !window.xingbeiDev.animations().active);
    for (const scene of ["attack-empty", "magic-empty", "shield-hit"]) {
      await page.goto(`${base}/web/dev.html?scene=${scene}`);
      await page.waitForFunction(() => window.xingbeiDev); await settled();
      const before = (await state()).game.players[0].hand.length;
      await page.locator("#dev-step").click();
      await page.waitForFunction(() => window.xingbeiDev.exportState().pendingChoice?.type === "hand");
      const waiting = await state();
      check(`${tag} ${scene}: 无牌进入共用选择流程`, waiting.pendingChoice.valid.length === 0 && waiting.game.players[0].hand.length === before);
      check(`${tag} ${scene}: 提示与通用标题完全相同`, await page.locator("#hint").textContent() === waiting.pendingChoice.title);
      check(`${tag} ${scene}: 六人固定坐次`, waiting.game.players.map(player => player.team).join() === "red,blue,blue,red,red,blue");
      check(`${tag} ${scene}: 所有手牌禁用且仍显示通用不响应`, await page.locator("#hand .card:enabled").count() === 0 && await page.getByRole("button", { name: "不响应", exact: true }).count() === 1 && await page.getByRole("button", { name: "确认", exact: true }).count() === 0);
      check(`${tag} ${scene}: 打出牌在场上`, waiting.game.field.length === 1 && waiting.game.field[0].location.zone === "field");
      await page.waitForTimeout(400);
      check(`${tag} ${scene}: 等待时不自动造成伤害`, (await state()).game.players[0].hand.length === before);
      await page.screenshot({ path: resolve(output, `${scene}-${tag}.png`) });
      await page.getByRole("button", { name: "不响应", exact: true }).click();
      await page.waitForFunction(() => window.xingbeiDev.exportState().pendingChoice === null); await settled();
      const after = await state(), trace = await page.evaluate(() => window.xingbeiDev.animations().trace);
      check(`${tag} ${scene}: 不响应后才结算且场上牌一起弃置`, after.game.field.length === 0 && after.game.discard.some(card => card.id === waiting.game.field[0].id));
      check(`${tag} ${scene}: 正确伤害类别或圣盾未命中`, scene === "shield-hit" ? !trace.some(event => event.type === "damage") && after.game.players[0].hand.length === before : trace.some(event => event.type === "damage" && event.damageType === (scene === "magic-empty" ? "spell" : "attack")) && after.game.players[0].hand.length === before + 2);
    }
    await page.goto(`${base}/web/dev.html?scene=overflow`);
    await page.waitForFunction(() => window.xingbeiDev.exportState().pendingChoice?.type === "hand");
    await page.locator('#hand .card[data-index="0"]').click();
    await page.locator('#hand .card[data-index="1"]').click();
    await page.getByRole("button", { name: "确认弃置", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.animation-card.card-back').length >= 2);
    check(`${tag}: 爆牌动画无明牌内容`, await page.locator('.animation-card.card-back').evaluateAll(nodes => nodes.every(node => node.textContent === "")));
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) {
        if (animation.effect?.target?.classList.contains("card-back")) { animation.pause(); animation.currentTime = 250; }
      }
    });
    await page.screenshot({ path: resolve(output, `hidden-discard-${tag}.png`) });
    await page.evaluate(() => { for (const animation of document.getAnimations()) if (animation.playState === "paused") animation.play(); });
    await settled();
    const overflow = await state();
    check(`${tag}: 暗弃牌的实际可见性与公开日志`, overflow.game.discard.filter(card => card.discardVisibility === "hidden").length === 2 && overflow.log.some(item => item.line.includes("暗弃2张手牌")));
    await page.close();
  }
  check("控制台及素材无错误", issues.length === 0);
} finally { await writeFile(resolve(output, "results.json"), JSON.stringify({ checks, issues }, null, 2)); await browser.close(); }
console.log(`通过${checks.length}项响应、伤害与暗弃检查。`);
