// Browser regression and screenshot evidence. Playwright is a development tool.
import { createRequire } from "node:module";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.CURRENT_URL || "http://127.0.0.1:4173";
const output = resolve(process.argv[2] || `xingbei-cli/artifacts/frontend/restoration/${new Date().toISOString().replaceAll(":", "-")}`);
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "run.json"), JSON.stringify({ started: new Date().toISOString(), base }, null, 2), { flag: "wx" });
const browser = await chromium.launch({ headless: true, args: process.env.BROWSER_NO_SANDBOX === "1" ? ["--no-sandbox"] : [], ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const issues = [], checks = [], captures = [];
const viewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
function check(label, value) { assert.ok(value, label); checks.push(label); }
async function settle(page) {
  await page.waitForFunction(() => !window.xingbeiDev.animations().playing && window.xingbeiDev.animations().active === 0, null, { timeout: 30000 });
  await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => animation.playState === "running").map(animation => animation.finished.catch(() => {}))); });
}

async function state(page) { return page.evaluate(() => window.xingbeiDev.exportState()); }
async function readyForScreenshot(page) {
  await page.waitForFunction(() => !window.xingbeiDev.animations().playing && window.xingbeiDev.animations().active === 0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode()));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}
async function capture(page, name, viewport) {
  await readyForScreenshot(page);
  await page.screenshot({ path: resolve(output, `${name}.png`), animations: "disabled", style: ".dev-tools { visibility: hidden; }" });
  const geometry = await page.evaluate(() => Object.fromEntries(["#arena", ".player", ".avatar", "#hand .card", "#control", ".zhanJi", ".dialog", ".stone-choice"].map(selector => [selector, [...document.querySelectorAll(selector)].map(node => {
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, text: node.innerText, display: style.display, font: style.fontFamily, background: style.backgroundImage };
  })])));
  await writeFile(resolve(output, `${name}.json`), JSON.stringify({ viewport, state: await state(page), geometry }, null, 2));
  captures.push(name);
}
try {
  for (const viewport of viewports) {
    const tag = `${viewport.width}x${viewport.height}`;
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: "zh-CN", timezoneId: "UTC", ...(viewport.width < 900 ? { hasTouch: true } : {}) });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on("pageerror", error => issues.push({ viewport: tag, type: "pageerror", text: error.message }));
    page.on("console", message => { if (message.type() === "error") issues.push({ viewport: tag, type: "console", text: message.text() }); });
    page.on("response", response => { if (response.status() >= 400) issues.push({ viewport: tag, type: "http", url: response.url(), status: response.status() }); });
    async function scene(id) {
      await page.goto(`${base}/web/dev.html?scene=${id}`);
      await page.waitForFunction(() => !!window.xingbeiDev);
      await page.waitForTimeout(60); await settle(page);
      await page.locator(".dev-tools").evaluate(toolbar => { toolbar.style.visibility = "hidden"; });
    }
    await scene("opening");
    check(`${tag}: 默认日志收起`, await page.locator("#log-panel").isHidden());
    const initial = await state(page);
    check(`${tag}: 默认六人座次和玩家位置正确`, initial.game.players.map(player => player.team).join(",") === "red,blue,blue,red,red,blue" && initial.perspective === 0);
    await capture(page, `opening-${tag}`, viewport);
    const evidenceRoot = process.env.ORIGINAL_EVIDENCE;
    if (evidenceRoot) {
      const original = JSON.parse(await readFile(resolve(evidenceRoot, `opening-${tag}.json`), "utf8"));
      check(`${tag}: 使用六人原版基准`, original.players.length === 6);
      const current = JSON.parse(await readFile(resolve(output, `opening-${tag}.json`), "utf8"));
      for (const [oldSelector, newSelector] of [["#arena", "#arena"], ["#arena > .player", ".player"], [".avatar", ".avatar"], ["#handcards1 .card", "#hand .card"], [".zhanJi", ".zhanJi"]]) {
        const olds = original.geometry[oldSelector], news = current.geometry[newSelector];
        check(`${tag}: ${newSelector}组件数量与原版一致`, olds.length === news.length);
        check(`${tag}: ${newSelector}边界误差不超过1px`, olds.every((old, index) => Object.keys(old.rect).every(key => Math.abs(old.rect[key] - news[index].rect[key]) <= 1)));
      }
    }
    await page.locator("#dev-reset").evaluate(button => button.click());
    await page.waitForTimeout(60); await settle(page);
    check(`${tag}: 固定开局可重复`, JSON.stringify((await state(page)).game) === JSON.stringify(initial.game));
    await page.locator("#toggle-log").click();
    check(`${tag}: 日志可打开`, await page.locator("#log-panel").isVisible());
    await page.locator("#close-log").click();
    for (const count of [0, 1, 4, 6]) {
      await scene(`hand-${count}`);
      check(`${tag}: ${count}张手牌`, await page.locator("#hand .card").count() === count);
      await capture(page, `hand-${count}-${tag}`, viewport);
    }
    await scene("target");
    await page.locator(".targetable").first().waitFor();
    check(`${tag}: 目标阶段禁用特殊行动`, await page.locator("#buy").isDisabled());
    await capture(page, `target-${tag}`, viewport);
    const targetState = await state(page);
    await page.locator("#hand .card").nth(1).click();
    check(`${tag}: 主动选目标时可改选攻击牌且未结算`, (await state(page)).selectedCard === 1 && (await state(page)).phase === "target" && JSON.stringify((await state(page)).game) === JSON.stringify(targetState.game));
    await page.locator("#hand .card").first().click();
    check(`${tag}: 主动选目标可切回法术牌`, (await state(page)).selectedCard === 0);

    await page.locator("#dev-reset").evaluate(button => button.click());
    await page.locator(".targetable").first().waitFor();
    check(`${tag}: 选牌重置完整导出状态一致`, JSON.stringify(targetState) === JSON.stringify(await state(page)));
    if (viewport.width < 900) await page.locator("#cancel-target").tap();
    else await page.locator("#cancel-target").click();
    check(`${tag}: 取消选牌无残留`, (await state(page)).selectedCard === null && await page.locator(".targetable").count() === 0);
    await page.locator("#hand .card").first().click();
    await page.locator("#hand .card").first().click();
    check(`${tag}: 再点牌取消`, (await state(page)).selectedCard === null);
    await page.locator("#hand .card").first().click();
    await page.locator('.player.targetable[data-player="1"]').click();
    await page.waitForFunction(() => window.xingbeiDev.exportState().current === 1);
    check(`${tag}: 目标提交接入引擎`, (await state(page)).game.players[1].statuses.find(card => card.attachment?.effectId === "weakness")?.name === "weakness");
    await page.locator("#dev-reset").evaluate(button => button.click());
    await page.locator("#cancel-target").waitFor();
    await page.locator("#cancel-target").click();
    await page.locator("#hand .card").nth(1).click();
    await page.locator(".player.untargetable").first().click();
    check(`${tag}: 非法目标不会提交`, (await state(page)).phase === "target");
    await page.locator("#dev-scene").evaluate(select => { select.value = "opening"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await page.waitForTimeout(60); await settle(page);
    check(`${tag}: 等待目标时重置无串局`, (await state(page)).phase === "action" && (await state(page)).selectedCard === null);
    await scene("unusable");
    await page.locator("#hand .card.unusable").first().click();
    check(`${tag}: 圣光不可主动使用`, (await state(page)).current === 0 && (await state(page)).selectedCard === null && await page.locator(".targetable").count() === 0);
    await capture(page, `unusable-${tag}`, viewport);
    await scene("purchase");
    await page.locator("#buy").evaluate(button => { button.click(); button.click(); });
    await page.waitForFunction(() => window.xingbeiDev.exportState().current === 1);
    const bought = await state(page);
    check(`${tag}: 购买结算`, bought.game.players[0].hand.length === 6 && bought.game.teams.red.achievements.length === 2);
    await capture(page, `purchase-${tag}`, viewport);
    await scene("synthesize");
    await page.locator("#synth").click();
    await page.locator(".stone-choice").first().waitFor();
    check(`${tag}: 合成不足3石不能确认`, await page.getByRole("button", { name: "确认", exact: true }).isDisabled());
    await capture(page, `synthesize-${tag}`, viewport);
    for (let index = 0; index < 3; index++) await page.locator(".stone-choice").nth(index).click();
    check(`${tag}: 合成选满仍等待确认且资源未变`, (await state(page)).pendingChoice.selected.length === 3 && (await state(page)).game.teams.red.achievements.length === 4);
    await page.locator(".stone-choice").first().click();
    check(`${tag}: 合成取消一石后确认禁用`, await page.getByRole("button", { name: "确认", exact: true }).isDisabled());
    await page.locator(".stone-choice").first().click();
    await page.getByRole("button", { name: "确认", exact: true }).evaluate(button => { button.click(); button.click(); });
    await page.waitForFunction(() => window.xingbeiDev.exportState().current === 1);
    check(`${tag}: 合成结算`, (await state(page)).game.teams.red.cups === 1 && (await state(page)).game.teams.red.achievements.length === 1);
    await scene("synthesize");
    await page.locator("#synth").click();
    for (let index = 0; index < 3; index++) await page.locator(".stone-choice").nth(index).click();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    check(`${tag}: 星石选择取消不消耗资源`, (await state(page)).game.teams.red.achievements.length === 4 && (await state(page)).phase === "action");
    await scene("refine");
    await page.locator("#refine").click();
    check(`${tag}: 提炼未选星石不能确认`, await page.getByRole("button", { name: "确认", exact: true }).isDisabled());
    await capture(page, `refine-${tag}`, viewport);
    await page.locator(".stone-choice").first().click();
    check(`${tag}: 提炼选一石可确认`, await page.getByRole("button", { name: "确认", exact: true }).isEnabled());
    await page.locator(".stone-choice").nth(1).click();
    check(`${tag}: 提炼选满仍等待确认且能量未变`, (await state(page)).pendingChoice.selected.length === 2 && (await state(page)).game.players[0].energy.gem === 0);
    await page.locator(".stone-choice").nth(1).click();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await page.waitForFunction(() => window.xingbeiDev.exportState().current === 1);
    check(`${tag}: 提炼结算`, (await state(page)).game.players[0].energy.gem === 1);
    await scene("refine");
    await page.locator("#refine").click();
    await page.locator(".stone-choice").first().click();
    await page.locator(".stone-choice").nth(1).click();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await page.waitForFunction(() => window.xingbeiDev.exportState().current === 1);
    check(`${tag}: 提炼两石仅在确认后结算`, (await state(page)).game.players[0].energy.gem + (await state(page)).game.players[0].energy.crystal === 2);
    await scene("opening");
    const handIds = (await state(page)).game.players[0].hand.map(card => card.id).sort();
    await page.locator("#sort-hand").click();
    const sortedHand = (await state(page)).game.players[0].hand;
    check(`${tag}: 整理攻击牌在法术前且保留全部手牌`, sortedHand[0].name === "earthStrike" && sortedHand[1].name === "windStrike" && JSON.stringify(sortedHand.map(card => card.id).sort()) === JSON.stringify(handIds));
    await scene("attack");
    await page.locator("#dev-step").evaluate(button => button.click());
    await page.locator("#modal:not(.hidden)").waitFor();
    await capture(page, `attack-${tag}`, viewport);
    check(`${tag}: 应战等待阶段`, (await state(page)).pendingChoice.type === "hand" && (await state(page)).pendingChoice.title.includes("对你使用"));
    await page.locator("#hand").getByRole("button", { name: /地裂斩/ }).click();
    await page.locator('.player.targetable[data-player="2"]').click();
    // Further counterattacks can ask the human again; choosing not to respond ends that branch.
    for (let attempt = 0; attempt < 600; attempt++) {
      await page.waitForTimeout(50);
      const snapshot = await state(page);
      if (snapshot.current === 2 && !snapshot.pendingChoice) break;
      if (!snapshot.pendingChoice) continue;
      const decline = page.getByRole("button", { name: "不响应", exact: true });
      if (await decline.isVisible()) await decline.click();
    }
    await settle(page);
    check(`${tag}: 应战链结算`, !(await state(page)).pendingChoice && (await state(page)).game.discard.some(card => card.name === "earthStrike"));
    await scene("magic");
    await page.locator("#dev-step").evaluate(button => button.click());
    await page.locator("#modal:not(.hidden)").waitFor();
    await capture(page, `magic-${tag}`, viewport);
    await page.locator("#hand").getByRole("button", { name: /圣光/ }).click();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await settle(page);
    check(`${tag}: 魔弹响应结算`, (await state(page)).current === 0 && !(await state(page)).pendingChoice);
    await scene("statuses");
    await capture(page, `statuses-${tag}`, viewport);
    check(`${tag}: 圣盾虚弱中毒标记`, await page.locator(".marks img").count() === 3);
    await scene("weakness");
    await page.locator("#modal:not(.hidden)").waitFor();
    await capture(page, `weakness-${tag}`, viewport);
    await page.getByRole("button", { name: "跳过本回合行动", exact: true }).click();
    await page.waitForFunction(() => window.xingbeiDev.exportState().current === 1);
    check(`${tag}: 虚弱跳过`, !(await state(page)).game.players[0].statuses.some(card => card.attachment?.effectId === "weakness"));
    await scene("overflow");
    await page.getByRole("button", { name: "确认弃置" }).waitFor();
    await capture(page, `overflow-${tag}`, viewport);
    await page.locator("#dev-reset").evaluate(button => button.click());
    await page.getByRole("button", { name: "确认弃置" }).waitFor();
    check(`${tag}: 爆牌需恰好2张`, await page.getByRole("button", { name: "确认弃置" }).isDisabled());
    await page.locator("#hand .card").nth(0).click();
    await page.locator("#hand .card").nth(1).click();
    await page.getByRole("button", { name: "确认弃置" }).click();
    await page.waitForFunction(() => window.xingbeiDev.exportState().game.teams.red.morale === 13);
    await settle(page);
    check(`${tag}: 爆牌结算`, (await state(page)).game.players[0].hand.length === 6 && (await state(page)).game.teams.red.morale === 13);
    await scene("overflow");
    await page.locator("#dev-scene").evaluate(select => { select.value = "opening"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await page.waitForTimeout(60); await settle(page);
    check(`${tag}: 弹窗等待时重置无残留`, await page.locator("#modal").isHidden() && (await state(page)).game.players[0].hand.length === 4);
    await scene("purchase");
    await page.locator("#buy").click();
    await page.waitForFunction(() => window.xingbeiDev.exportState().current === 1);
    await page.evaluate(() => { window.xingbeiDev.step(); document.querySelector("#dev-scene").value = "opening"; window.xingbeiDev.reset(); });
    await settle(page);
    check(`${tag}: AI等待时重置无串局`, (await state(page)).current === 0 && (await state(page)).game.players[0].hand.length === 4);
    await scene("end");
    await page.locator("#modal:not(.hidden)").waitFor();
    await capture(page, `end-${tag}`, viewport);
    await page.getByRole("button", { name: "再来一局", exact: true }).click();
    await page.waitForFunction(() => window.xingbeiDev.exportState().game.winner === null);
    await page.getByRole("button", { name: "正常游玩", exact: true }).click();
    await page.getByRole("heading", { name: "选择角色" }).waitFor();
    await page.getByRole("button", { name: "狂战士", exact: true }).click();
    await page.waitForFunction(() => window.xingbeiDev.exportState().game.players[0].hand.length === 4);
    check(`${tag}: 结束后重开`, await page.locator("#modal").isHidden());
    await scene("purchase");
    await page.locator("#buy").click();
    await page.waitForFunction(() => window.xingbeiDev.exportState().current === 1);
    await page.waitForTimeout(60); await settle(page); // Allow the paused turn gate to install after current changes.
    await page.locator("#dev-step").evaluate(button => button.click());
    // Six-player AI can legally reach the human through an attack/magic chain.
    // Complete that response before checking the next paused turn boundary.
    for (let attempt = 0; attempt < 600; attempt++) {
      await settle(page);
      const snapshot = await state(page);
      if (snapshot.current === 2) break;
      const decline = page.getByRole("button", { name: "不响应", exact: true });
      if (await decline.isVisible()) await decline.click();
      else if (snapshot.pendingChoice?.type === "hand") {
        for (const index of snapshot.pendingChoice.valid.slice(0, snapshot.pendingChoice.count)) await page.locator("#hand .card").nth(index).click();
        await page.locator("#modal-actions button:enabled").first().click();
      }
    }
    await writeFile(resolve(output, `step-${tag}.json`), JSON.stringify(await state(page), null, 2));
    check(`${tag}: 单步推进一个AI回合`, (await state(page)).current === 2);
    await context.close();
  }
  const page = await browser.newPage({ viewport: viewports[0] });
  await page.goto(base);
  await page.getByRole("button", { name: "正常游玩", exact: true }).click();
  await page.getByRole("button", { name: "狂战士", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("#hand .card").length === 4);
  const font = await page.request.get(`${base}/font/xingkai.woff2`);
  check("字体路由与MIME正确", font.status() === 200 && font.headers()["content-type"] === "font/woff2");
  check("正常网页不暴露开发工具", await page.locator(".dev-tools").count() === 0 && await page.evaluate(() => !window.xingbeiDev));
  check("图片完整加载", await page.evaluate(() => [...document.images].every(image => image.complete && image.naturalWidth > 0)));
  await page.close();
  check("全部场景无控制台或资源错误", issues.length === 0);
} finally {
  await writeFile(resolve(output, "results.json"), JSON.stringify({ browser: browser.version(), checks, captures, issues }, null, 2));
  await browser.close();
}
console.log(`Passed ${checks.length} browser checks; saved ${captures.length} screenshots to ${output}`);
