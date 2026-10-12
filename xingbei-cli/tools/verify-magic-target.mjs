// Browser checks for fixed magic targets and consecutive-seat transmission.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.CURRENT_URL || "http://127.0.0.1:4173";
const output = resolve(process.argv[2] || "xingbei-cli/artifacts/frontend/restoration/2026-10-10/magic-target");
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
    const target = id => page.locator(`.player.targetable[data-player="${id}"]`);
    async function start(scene) {
      await page.goto(`${base}/web/dev.html?scene=${scene}`, { waitUntil: "networkidle" });
      // Keep diagnostics outside the game interaction area, as in normal play.
      await page.locator(".dev-tools").evaluate(toolbar => { toolbar.style.visibility = "hidden"; });
      check(`${tag}/${scene}: 六人指定座次及玩家红一`, (await state()).game.players.map(player => player.team).join(",") === "red,blue,blue,red,red,blue" && (await state()).perspective === 0);
    }
    async function beginLinked() {
      await start("magic-linked");
      const ownership = (await state()).game.players.flatMap(player => player.hand.map(item => ({ id: item.id, name: player.name })));
      await page.locator("#dev-step").evaluate(button => button.click());
      await page.waitForFunction(() => window.xingbeiDev.exportState().pendingChoice?.title.includes("蓝三"));
      return ownership;
    }
    await start("magic-start"); await select(card(0));
    check(`${tag}: 发起魔弹仅高亮下一对手`, JSON.stringify((await state()).legalTargets) === "[1]" && await page.locator(".targetable").count() === 1);
    check(`${tag}: 点目标前不消耗牌`, (await state()).game.players[0].hand.length === 2 && (await state()).game.discard.length === 0);
    check(`${tag}: 选中魔弹上浮且无确认按钮`, await card(0).getAttribute("aria-pressed") === "true" && await page.getByRole("button", { name: /^(确认|确定)$/ }).count() === 0);
    await page.locator('.player[data-player="2"]').evaluate(node => node.click());
    check(`${tag}: 其他对手不能作为目标`, (await state()).phase === "target");
    await page.screenshot({ path: resolve(output, `start-${tag}.png`) });
    await page.locator("#cancel-target").click();
    check(`${tag}: 取消发起不消耗牌`, (await state()).game.discard.length === 0 && (await state()).selectedCard === null);
    await select(card(0)); await page.keyboard.press("Escape");
    check(`${tag}: Esc取消发起`, (await state()).phase === "action");
    await select(card(0)); await page.locator("#dev-reset").evaluate(button => button.click());
    check(`${tag}: 发起目标等待可重置`, (await state()).selectedCard === null && (await state()).game.discard.length === 0);
    await select(card(0)); await target(1).evaluate(node => { node.click(); node.click(); });
    await page.waitForFunction(() => window.xingbeiDev.exportState().current === 1);
    check(`${tag}: 点击唯一目标结算且双击仅出一张`, (await state()).game.discard.length === 1 && (await state()).game.players[1].hand.length === 2);
    const ownership = await beginLinked();
    check(`${tag}: 蓝三实际传到玩家时才等待响应`, (await state()).game.field.filter(item => item.name === "magicBullet").map(item => ownership.find(original => original.id === item.id).name).join(",") === "蓝三");
    await select(card(0));
    check(`${tag}: 传递仅高亮蓝一且牌未消耗`, JSON.stringify((await state()).legalTargets) === "[1]" && (await state()).game.players[0].hand[0].name === "magicBullet");
    await page.screenshot({ path: resolve(output, `relay-${tag}.png`) });
    await page.getByRole("button", { name: "取消", exact: true }).click();
    check(`${tag}: 取消传递回到选牌`, (await state()).pendingChoice.type === "hand" && (await state()).selectedCard === null);
    const beforeLight = (await state()).game;
    await select(card(0)); await select(card(1));
    check(`${tag}: 魔弹圣光选中后等待确认且未结算`, (await state()).selectedCard === 1 && (await state()).legalTargets.length === 0 && JSON.stringify((await state()).game) === JSON.stringify(beforeLight));
    check(`${tag}: 魔弹圣光只显示确认与使用提示`, (await page.locator("#modal-actions button:visible").allTextContents()).join() === "确认" && await page.locator("#hint").textContent() === `${(await state()).pendingChoice.title}，确认使用圣光`);
    await page.screenshot({ path: resolve(output, `light-confirm-${tag}.png`) });
    await select(card(0));
    check(`${tag}: 圣光确认前可改选魔弹且仍等待目标`, (await state()).selectedCard === 0 && JSON.stringify((await state()).legalTargets) === "[1]" && await page.getByRole("button", { name: "确认", exact: true }).count() === 0);
    check(`${tag}: 已选魔弹不可直接不响应`, await page.getByRole("button", { name: "不响应", exact: true }).count() === 0);
    await select(card(1)); await select(card(1));
    check(`${tag}: 魔弹圣光可取消且不消耗牌`, (await state()).selectedCard === null && JSON.stringify((await state()).game) === JSON.stringify(beforeLight));
    check(`${tag}: 撤回圣光只显示不响应`, (await page.locator("#modal-actions button:visible").allTextContents()).join() === "不响应");
    await select(card(1));
    await page.getByRole("button", { name: "确认", exact: true }).evaluate(button => { button.click(); button.click(); });
    await page.waitForFunction(() => window.xingbeiDev.exportState().pendingChoice === null); await settle(page);
    check(`${tag}: 魔弹圣光确认后才抵消`, (await state()).game.players[0].hand.length === 1 && (await state()).game.players[0].hand[0].name === "magicBullet" && (await state()).game.players[1].hand.length === 1);
    const relayOwnership = await beginLinked(); await select(card(0));
    await target(1).evaluate(node => { node.click(); node.click(); });
    await page.waitForFunction(() => window.xingbeiDev.exportState().pendingChoice === null); await settle(page);
    check(`${tag}: 六人完整传递刷新后命中蓝三`, (await state()).game.players[5].hand.length === 6 && (await state()).game.discard.filter(item => item.name === "magicBullet").map(item => relayOwnership.find(original => original.id === item.id).name).join(",") === "蓝三,红一,蓝一,红二,蓝二,红三");
    check(`${tag}: 结算无目标和选牌残留`, (await state()).selectedCard === null && (await state()).legalTargets.length === 0);
    await beginLinked(); await select(card(0)); await page.locator("#dev-reset").evaluate(button => button.click());
    await page.waitForTimeout(60); await settle(page);
    check(`${tag}: 传递目标等待重置无串局`, (await state()).game.discard.length === 0 && (await state()).pendingChoice === null && (await state()).current === 5);
    await start("magic"); await page.locator("#dev-step").evaluate(button => button.click());
    await page.waitForFunction(() => window.xingbeiDev.exportState().pendingChoice?.type === "hand");
    await select(card(0));
    check(`${tag}: 六人传递跳过本轮已参与的对手`, JSON.stringify((await state()).legalTargets) === "[1]");
    await select(card(0));
    await page.getByRole("button", { name: "不响应", exact: true }).click();
    await page.waitForFunction(() => window.xingbeiDev.exportState().pendingChoice === null); await settle(page);
    check(`${tag}: 撤回魔弹选牌后可不响应`, (await state()).game.players[0].hand.some(item => item.name === "magicBullet"));
    await page.close();
  }
  check("魔弹全部场景无控制台与素材错误", issues.length === 0);
} finally {
  await writeFile(resolve(output, "results.json"), JSON.stringify({ checks, issues }, null, 2));
  await browser.close();
}
console.log(`通过${checks.length}项魔弹目标检查。`);
