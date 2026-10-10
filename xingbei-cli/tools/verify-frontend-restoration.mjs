// Browser regression and screenshot evidence. Playwright is a development tool.
import { createRequire } from "node:module";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.CURRENT_URL || "http://127.0.0.1:4181";
const output = resolve(process.argv[2] || `xingbei-cli/artifacts/frontend/restoration/${new Date().toISOString().replaceAll(":", "-")}`);
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "run.json"), JSON.stringify({ started: new Date().toISOString(), base }, null, 2), { flag: "wx" });
const browser = await chromium.launch({ headless: true, args: process.env.BROWSER_NO_SANDBOX === "1" ? ["--no-sandbox"] : [], ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const issues = [], checks = [], captures = [];
const viewports = [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 844, height: 390 }, { width: 390, height: 844 }];
function check(label, value) { assert.ok(value, label); checks.push(label); }
async function state(page) { return page.evaluate(() => window.xingbeiDev.exportState()); }
const repetitions = [];
async function readyForScreenshot(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode()));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}
async function picture(page) {
  await readyForScreenshot(page);
  return page.screenshot({ animations: "disabled", style: ".dev-tools { visibility: hidden; }" });
}
async function checkRepeat(page, before, name) {
  const after = await picture(page);
  await writeFile(resolve(output, `${name}-reset.png`), after);
  const differences = await page.evaluate(async images => {
    const pixels = [];
    for (const bytes of images) {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${bytes}`)).blob());
      const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext("2d"); context.drawImage(bitmap, 0, 0);
      pixels.push(context.getImageData(0, 0, bitmap.width, bitmap.height).data);
    }
    let maxChannelDelta = 0, changedPixels = 0;
    for (let index = 0; index < pixels[0].length; index += 4) {
      let changed = false;
      for (let channel = 0; channel < 4; channel++) {
        const delta = Math.abs(pixels[0][index + channel] - pixels[1][index + channel]);
        if (delta) changed = true;
        maxChannelDelta = Math.max(maxChannelDelta, delta);
      }
      if (changed) changedPixels++;
    }
    return { maxChannelDelta, changedPixels, totalPixels: pixels[0].length / 4 };
  }, [before.toString("base64"), after.toString("base64")]);
  const hash = bytes => createHash("sha256").update(bytes).digest("hex");
  repetitions.push({ name, before: hash(before), after: hash(after), ...differences, withinTolerance: differences.maxChannelDelta <= 4 });
  // Calibrated from repeated resets in the same browser, never used to mask
  // differences between the original and reconstructed application.
  // Collect every viewport and interaction before reporting screenshot drift.
  if (differences.maxChannelDelta <= 4) check(`${name}: 重置像素波动不超过4/255`, true);
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
      await page.waitForTimeout(60);
    }
    await scene("opening");
    check(`${tag}: 默认日志收起`, await page.locator("#log-panel").isHidden());
    const initial = await state(page);
    const openingPicture = await picture(page);
    await capture(page, `opening-${tag}`, viewport);
    const evidenceRoot = process.env.ORIGINAL_EVIDENCE;
    if (evidenceRoot) {
      const original = JSON.parse(await readFile(resolve(evidenceRoot, `opening-${tag}.json`), "utf8"));
      const current = JSON.parse(await readFile(resolve(output, `opening-${tag}.json`), "utf8"));
      for (const [oldSelector, newSelector] of [["#arena", "#arena"], ["#arena > .player", ".player"], [".avatar", ".avatar"], ["#handcards1 .card", "#hand .card"], [".zhanJi", ".zhanJi"]]) {
        const olds = original.geometry[oldSelector], news = current.geometry[newSelector];
        check(`${tag}: ${newSelector}组件数量与原版一致`, olds.length === news.length);
        check(`${tag}: ${newSelector}边界误差不超过1px`, olds.every((old, index) => Object.keys(old.rect).every(key => Math.abs(old.rect[key] - news[index].rect[key]) <= 1)));
      }
    }
    await page.locator("#dev-reset").click();
    await page.waitForTimeout(60);
    check(`${tag}: 固定开局可重复`, JSON.stringify((await state(page)).game) === JSON.stringify(initial.game));
    await checkRepeat(page, openingPicture, `opening-${tag}`);
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
    const targetPicture = await picture(page);
    const targetState = await state(page);
    await page.locator("#dev-reset").click();
    await page.locator(".targetable").first().waitFor();
    check(`${tag}: 选牌重置完整导出状态一致`, JSON.stringify(targetState) === JSON.stringify(await state(page)));
    await checkRepeat(page, targetPicture, `target-${tag}`);
    if (viewport.width < 900) await page.locator("#cancel-target").tap();
    else await page.locator("#cancel-target").click();
    check(`${tag}: 取消选牌无残留`, (await state(page)).selectedCard === null && await page.locator(".targetable").count() === 0);
    await page.locator("#hand .card").first().click();
    await page.locator("#hand .card").first().click();
    check(`${tag}: 再点牌取消`, (await state(page)).selectedCard === null);
    await page.locator("#hand .card").first().click();
    await page.locator('.player.targetable[data-player="1"]').click();
    await page.waitForFunction(() => window.xingbeiDev.exportState().current === 1);
    check(`${tag}: 目标提交接入引擎`, (await state(page)).game.players[1].weakness?.name === "xuRuo");
    await page.locator("#dev-reset").click();
    await page.locator("#cancel-target").waitFor();
    await page.locator("#cancel-target").click();
    await page.locator("#hand .card").nth(1).click();
    await page.locator(".player.untargetable").first().click();
    check(`${tag}: 非法目标不会提交`, (await state(page)).phase === "target");
    await page.locator("#dev-scene").selectOption("opening");
    await page.waitForTimeout(60);
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
    check(`${tag}: 整理攻击牌在法术前且保留全部手牌`, sortedHand[0].name === "diLieZhan" && sortedHand[1].name === "fengShenZhan" && JSON.stringify(sortedHand.map(card => card.id).sort()) === JSON.stringify(handIds));
    await scene("attack");
    await page.locator("#dev-step").click();
    await page.locator("#modal:not(.hidden)").waitFor();
    await capture(page, `attack-${tag}`, viewport);
    check(`${tag}: 应战等待阶段`, (await state(page)).pendingChoice.title.includes("主动攻击"));
    await page.locator("#hand").getByRole("button", { name: /地裂斩/ }).click();
    await page.locator('.player.targetable[data-player="3"]').click();
    // Further counterattacks can ask the human again; choosing not to respond ends that branch.
    for (let attempt = 0; attempt < 12; attempt++) {
      await page.waitForTimeout(50);
      const snapshot = await state(page);
      if (!snapshot.pendingChoice) break;
      const decline = page.getByRole("button", { name: "不使用", exact: true });
      if (await decline.isVisible()) await decline.click();
    }
    check(`${tag}: 应战链结算`, !(await state(page)).pendingChoice && (await state(page)).game.discard.some(card => card.name === "diLieZhan"));
    await scene("magic");
    await page.locator("#dev-step").click();
    await page.locator("#modal:not(.hidden)").waitFor();
    await capture(page, `magic-${tag}`, viewport);
    await page.locator("#hand").getByRole("button", { name: /圣光/ }).click();
    await page.waitForTimeout(80);
    check(`${tag}: 魔弹响应结算`, (await state(page)).current === 2 && !(await state(page)).pendingChoice);
    await scene("statuses");
    await capture(page, `statuses-${tag}`, viewport);
    check(`${tag}: 圣盾虚弱中毒标记`, await page.locator(".marks img").count() === 3);
    await scene("weakness");
    await page.locator("#modal:not(.hidden)").waitFor();
    await capture(page, `weakness-${tag}`, viewport);
    await page.getByRole("button", { name: "跳过本回合行动", exact: true }).click();
    await page.waitForFunction(() => window.xingbeiDev.exportState().current === 1);
    check(`${tag}: 虚弱跳过`, (await state(page)).game.players[0].weakness === null);
    await scene("overflow");
    await page.getByRole("button", { name: "确认弃置" }).waitFor();
    await capture(page, `overflow-${tag}`, viewport);
    const overflowPicture = await picture(page);
    await page.locator("#dev-reset").click();
    await page.getByRole("button", { name: "确认弃置" }).waitFor();
    await checkRepeat(page, overflowPicture, `overflow-${tag}`);
    check(`${tag}: 爆牌需恰好2张`, await page.getByRole("button", { name: "确认弃置" }).isDisabled());
    await page.locator("#hand .card").nth(0).click();
    await page.locator("#hand .card").nth(1).click();
    await page.getByRole("button", { name: "确认弃置" }).click();
    check(`${tag}: 爆牌结算`, (await state(page)).game.players[0].hand.length === 6 && (await state(page)).game.teams.red.morale === 13);
    await scene("overflow");
    await page.locator("#dev-scene").selectOption("opening");
    await page.waitForTimeout(60);
    check(`${tag}: 弹窗等待时重置无残留`, await page.locator("#modal").isHidden() && (await state(page)).game.players[0].hand.length === 4);
    await scene("purchase");
    await page.locator("#buy").click();
    await page.waitForFunction(() => window.xingbeiDev.exportState().current === 1);
    await page.evaluate(() => { window.xingbeiDev.step(); document.querySelector("#dev-scene").value = "opening"; window.xingbeiDev.reset(); });
    await page.waitForTimeout(80);
    check(`${tag}: AI等待时重置无串局`, (await state(page)).current === 0 && (await state(page)).game.players[0].hand.length === 4);
    await scene("end");
    await page.locator("#modal:not(.hidden)").waitFor();
    await capture(page, `end-${tag}`, viewport);
    await page.getByRole("button", { name: "再来一局", exact: true }).click();
    await page.waitForFunction(() => window.xingbeiDev.exportState().game.winner === null);
    check(`${tag}: 结束后重开`, await page.locator("#modal").isHidden());
    await scene("purchase");
    await page.locator("#buy").click();
    await page.waitForFunction(() => window.xingbeiDev.exportState().current === 1);
    await page.locator("#dev-step").click();
    await page.waitForTimeout(100);
    check(`${tag}: 单步推进一个AI回合`, (await state(page)).current === 2);
    await context.close();
  }
  const page = await browser.newPage({ viewport: viewports[0] });
  await page.goto(base);
  const font = await page.request.get(`${base}/font/xingkai.woff2`);
  check("字体路由与MIME正确", font.status() === 200 && font.headers()["content-type"] === "font/woff2");
  check("正常网页不暴露开发工具", await page.locator(".dev-tools").count() === 0 && await page.evaluate(() => !window.xingbeiDev));
  check("图片完整加载", await page.evaluate(() => [...document.images].every(image => image.complete && image.naturalWidth > 0)));
  await page.close();
  check("全部场景无控制台或资源错误", issues.length === 0);
  check("全部重置截图符合既有4/255颜色波动阈值", repetitions.every(item => item.withinTolerance));
} finally {
  await writeFile(resolve(output, "results.json"), JSON.stringify({ browser: browser.version(), checks, captures, issues, repetitions }, null, 2));
  await browser.close();
}
console.log(`Passed ${checks.length} browser checks; saved ${captures.length} screenshots to ${output}`);
