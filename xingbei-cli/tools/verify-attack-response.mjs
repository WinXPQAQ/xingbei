// Targeted browser regression for switching response cards before choosing a target.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.CURRENT_URL || "http://127.0.0.1:4173";
const output = resolve(process.argv[2] || "xingbei-cli/artifacts/frontend/restoration/2026-10-10/attack-switch");
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "run.json"), JSON.stringify({ base, started: new Date().toISOString() }), { flag: "wx" });
const browser = await chromium.launch({ headless: true, args: process.env.BROWSER_NO_SANDBOX === "1" ? ["--no-sandbox"] : [], ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const checks = [], issues = [];
function check(label, value) { assert.ok(value, label); checks.push(label); }
async function settle(page) {
  await page.waitForFunction(() => !window.xingbeiDev.animations().playing && window.xingbeiDev.animations().active === 0, null, { timeout: 30000 });
  await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => animation.playState === "running").map(animation => animation.finished.catch(() => {}))); });
}

try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const tag = `${viewport.width}x${viewport.height}`;
    const page = await browser.newPage({ viewport, ...(viewport.width < 900 ? { hasTouch: true } : {}) });
    page.on("pageerror", error => issues.push(error.message));
    page.on("console", message => { if (message.type() === "error") issues.push(message.text()); });
    page.on("response", response => { if (response.status() >= 400) issues.push(response.url()); });
    const state = () => page.evaluate(() => window.xingbeiDev.exportState());
    const card = index => page.locator("#hand .card").nth(index);
    const select = async locator => { await (viewport.width < 900 ? locator.tap() : locator.click()); await page.evaluate(async () => { await Promise.all(document.querySelector("#hand").getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))); }); };
    async function start() {
      await page.goto(`${base}/web/dev.html?scene=attack-switch`, { waitUntil: "networkidle" });
      check(`${tag}: 六人指定座次及玩家红一`, (await state()).game.players.map(player => player.team).join(",") === "red,blue,blue,red,red,blue" && (await state()).perspective === 0);
      await page.locator("#dev-step").click();
      await page.waitForFunction(() => window.xingbeiDev.exportState().pendingChoice?.type === "hand");
    }
    await start();
    const initial = (await state()).game.players[0].hand;
    await select(card(0));
    check(`${tag}: 选牌直接进入选对手`, (await state()).phase === "target" && (await state()).selectedCard === 0);
    check(`${tag}: 不增加确认按钮`, await page.getByRole("button", { name: /^(确认|确定)$/ }).count() === 0);
    await select(card(1));
    check(`${tag}: 选对手时可切换应战牌`, (await state()).selectedCard === 1 && (await state()).pendingChoice.selected[0] === 1);
    check(`${tag}: 切换前不消耗手牌`, JSON.stringify((await state()).game.players[0].hand) === JSON.stringify(initial));
    check(`${tag}: 只上浮当前应战牌`, await page.locator("#hand .card.selected").count() === 1 && await card(1).getAttribute("aria-pressed") === "true" && await card(0).getAttribute("aria-pressed") === "false");
    const selectedBox = await card(1).boundingBox(), otherBox = await card(0).boundingBox();
    check(`${tag}: 上浮效果可见`, selectedBox.y < otherBox.y - 5);
    check(`${tag}: 不合法应战牌禁用`, await card(2).isDisabled());
    await card(2).evaluate(button => button.click());
    check(`${tag}: 非法牌不改变选中牌`, (await state()).selectedCard === 1);
    await page.locator('.player[data-player="1"]').evaluate(player => player.click());
    check(`${tag}: 不能应战攻击原攻击者`, (await state()).phase === "target");
    await page.screenshot({ path: resolve(output, `selected-${tag}.png`) });
    await select(card(1));
    check(`${tag}: 再点当前牌返回选牌阶段`, (await state()).selectedCard === null && (await state()).legalTargets.length === 0);
    await select(card(0));
    await page.getByRole("button", { name: "取消", exact: true }).click();
    check(`${tag}: 取消可重新选应战牌`, (await state()).selectedCard === null && (await state()).pendingChoice.type === "hand");
    await select(card(0));
    await page.keyboard.press("Escape");
    check(`${tag}: Esc返回选牌`, (await state()).selectedCard === null && (await state()).pendingChoice.type === "hand");
    await select(card(0)); await select(card(1));
    await page.locator('.player.targetable[data-player="2"]').evaluate(player => { player.click(); player.click(); });
    for (let attempt = 0; attempt < 20; attempt++) {
      await page.waitForTimeout(30);
      if (!(await state()).pendingChoice) break;
      const decline = page.getByRole("button", { name: "不响应", exact: true });
      if (await decline.isVisible()) await decline.click();
    }
    await settle(page);
    const settled = await state();
    check(`${tag}: 结算使用切换后的牌且仅弃一次`, settled.game.discard.filter(item => item.id === initial[1].id).length === 1 && settled.game.players[0].hand.some(item => item.id === initial[0].id));
    check(`${tag}: 结算后无选牌或目标残留`, settled.selectedCard === null && settled.pendingChoice === null && settled.legalTargets.length === 0);
    await start();
    const beforeLight = (await state()).game;
    await select(card(0)); await select(card(3));
    check(`${tag}: 应战圣光选中后等待确认且未结算`, (await state()).selectedCard === 3 && (await state()).legalTargets.length === 0 && JSON.stringify((await state()).game) === JSON.stringify(beforeLight));
    check(`${tag}: 圣光只显示确认且提示使用圣光`, (await page.locator("#modal-actions button:visible").allTextContents()).join() === "确认" && await page.locator("#hint").textContent() === `${(await state()).pendingChoice.title}，确认使用圣光`);
    await page.screenshot({ path: resolve(output, `light-confirm-${tag}.png`) });
    await select(card(1));
    check(`${tag}: 圣光确认前可改选攻击牌且改为选对手`, (await state()).selectedCard === 1 && (await state()).phase === "target" && await page.getByRole("button", { name: "确认", exact: true }).count() === 0);
    check(`${tag}: 选应战牌后不能直接不响应`, await page.getByRole("button", { name: "不响应", exact: true }).count() === 0);
    await select(card(3)); await select(card(3));
    check(`${tag}: 再点圣光撤回后恢复不响应`, (await state()).selectedCard === null && (await page.locator("#modal-actions button:visible").allTextContents()).join() === "不响应" && JSON.stringify((await state()).game) === JSON.stringify(beforeLight));
    await select(card(3)); await page.keyboard.press("Escape");
    check(`${tag}: 圣光可取消并保留原手牌`, (await state()).selectedCard === null && JSON.stringify((await state()).game) === JSON.stringify(beforeLight));
    await select(card(3));
    await page.getByRole("button", { name: "确认", exact: true }).evaluate(button => { button.click(); button.click(); });
    await page.waitForFunction(() => window.xingbeiDev.exportState().pendingChoice === null); await settle(page);
    check(`${tag}: 应战圣光确认后才抵消且不消耗先前攻击牌`, (await state()).game.players[0].hand.some(item => item.name === "earthStrike") && (await state()).game.discard.some(item => item.name === "holyLight"));
    await start(); await select(card(0));
    await select(card(0));
    await page.getByRole("button", { name: "不响应", exact: true }).click();
    await page.waitForFunction(() => window.xingbeiDev.exportState().pendingChoice === null); await settle(page);
    const declinedHand = (await state()).game.players[0].hand;
    check(`${tag}: 撤回应战选牌后可不响应`, declinedHand.length === 6 && initial.slice(0, 2).every(original => declinedHand.some(item => item.id === original.id)));
    await start(); await select(card(0)); await page.locator("#dev-reset").click();
    await page.waitForTimeout(60); await settle(page);
    check(`${tag}: 重置取消旧应战等待`, (await state()).selectedCard === null && (await state()).pendingChoice === null && (await state()).current === 1);
    await page.close();
  }
  check("无控制台或素材错误", issues.length === 0);
} finally {
  await writeFile(resolve(output, "results.json"), JSON.stringify({ checks, issues }, null, 2));
  await browser.close();
}
console.log(`通过${checks.length}项应战切牌检查。`);
