// Shared six-player response regression: attack, magic, empty response and hidden overflow.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.CURRENT_URL || "http://127.0.0.1:4173";
const output = resolve(process.argv[2] || "xingbei-cli/artifacts/tools/responses");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"], ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const checks = new Set(), issues = [];
const check = (label, value) => { assert.ok(value, label); checks.add(label); };

async function checkHolyLight(ctx, lightIndex, otherIndex, name) {
  const { page, tag, state, card, select, settle } = ctx;
  const before = (await state()).game;
  const lightId = before.players[0].hand[lightIndex].id, otherId = before.players[0].hand[otherIndex].id;
  await select(card(otherIndex)); await select(card(lightIndex));
  check(`${tag}/${name}: 圣光待提交不结算`, (await state()).selectedCard === lightIndex && (await state()).legalTargets.length === 0 && JSON.stringify((await state()).game) === JSON.stringify(before));
  check(`${tag}/${name}: 圣光仅有确认及使用提示`, (await page.locator("#modal-actions button:visible").allTextContents()).join() === "确认" && await page.locator("#hint").textContent() === `${(await state()).pendingChoice.title}，确认使用圣光`);
  await page.screenshot({ path: resolve(output, `${name}-light-${tag}.png`) });
  await select(card(otherIndex));
  check(`${tag}/${name}: 可切换合法响应牌选目标`, (await state()).selectedCard === otherIndex && (await state()).legalTargets.length > 0 && await page.getByRole("button", { name: "确认", exact: true }).count() === 0);
  check(`${tag}/${name}: 已选牌不可不响应`, await page.getByRole("button", { name: "不响应", exact: true }).count() === 0);
  await select(card(lightIndex)); await select(card(lightIndex));
  check(`${tag}/${name}: 再点圣光撤回且恢复不响应`, (await state()).selectedCard === null && (await page.locator("#modal-actions button:visible").allTextContents()).join() === "不响应" && JSON.stringify((await state()).game) === JSON.stringify(before));
  await select(card(lightIndex)); await page.keyboard.press("Escape");
  check(`${tag}/${name}: Esc撤回不移动牌`, (await state()).selectedCard === null && JSON.stringify((await state()).game) === JSON.stringify(before));
  await select(card(lightIndex));
  await page.getByRole("button", { name: "确认", exact: true }).evaluate(button => { button.click(); button.click(); });
  await page.waitForFunction(() => window.xingbeiDev.exportState().pendingChoice === null); await settle(page);
  const after = (await state()).game;
  check(`${tag}/${name}: 确认仅使用圣光且双击不重复`, after.discard.filter(card => card.id === lightId).length === 1 && after.players[0].hand.some(card => card.id === otherId));
}

async function checkAttack(ctx) {
  const { page, viewport, tag, state, card, select, settle } = ctx;
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
  await checkHolyLight(ctx, 3, 1, "attack");
  await start(); await select(card(0));
  await select(card(0));
  await page.getByRole("button", { name: "不响应", exact: true }).click();
  await page.waitForFunction(() => window.xingbeiDev.exportState().pendingChoice === null); await settle(page);
  const declinedHand = (await state()).game.players[0].hand;
  check(`${tag}: 撤回应战选牌后可不响应`, declinedHand.length === 6 && initial.slice(0, 2).every(original => declinedHand.some(item => item.id === original.id)));
  await start(); await select(card(0)); await page.locator("#dev-reset").click();
  await page.waitForTimeout(60); await settle(page);
  check(`${tag}: 重置取消旧应战等待`, (await state()).selectedCard === null && (await state()).pendingChoice === null && (await state()).current === 1);
}

async function checkMagic(ctx) {
  const { page, viewport, tag, state, card, select, settle } = ctx;
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
  await checkHolyLight(ctx, 1, 0, "magic");
  check(`${tag}: 魔弹圣光抵消后对手未摸牌`, (await state()).game.players[1].hand.length === 1);
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
}

async function checkEmptyAndOverflow(ctx) {
  const { page, viewport, tag, state, card, select, settle } = ctx;
  for (const scene of ["attack-empty", "magic-empty", "shield-hit"]) {
    await page.goto(`${base}/web/dev.html?scene=${scene}`);
    await page.waitForFunction(() => window.xingbeiDev); await settle(page);
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
    await page.waitForFunction(() => window.xingbeiDev.exportState().pendingChoice === null); await settle(page);
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
  await settle(page);
  const overflow = await state();
  check(`${tag}: 暗弃牌的实际可见性与公开日志`, overflow.game.discard.filter(card => card.discardVisibility === "hidden").length === 2 && overflow.log.some(item => item.line.includes("暗弃2张手牌")));
}

try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, hasTouch: viewport.width < 500 });
    page.on("pageerror", error => issues.push(error.message));
    page.on("console", message => { if (message.type() === "error") issues.push(message.text()); });
    page.on("response", response => { if (response.status() >= 400) issues.push(response.url()); });
    const state = () => page.evaluate(() => window.xingbeiDev.exportState());
    const settle = async () => {
      await page.waitForFunction(() => !window.xingbeiDev.animations().playing && !window.xingbeiDev.animations().active);
      await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => animation.playState === "running").map(animation => animation.finished.catch(() => {}))); });
    };
    const card = index => page.locator("#hand .card").nth(index);
    const select = async locator => {
      await (viewport.width < 500 ? locator.tap() : locator.click());
      await page.evaluate(async () => { await Promise.all(document.querySelector("#hand").getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))); });
    };
    const ctx = { page, viewport, tag: `${viewport.width}x${viewport.height}`, state, card, select, settle };
    await checkAttack(ctx); await checkMagic(ctx); await checkEmptyAndOverflow(ctx);
    await page.close();
  }
  check("全部响应场景无控制台/素材错误", issues.length === 0);
} finally {
  await writeFile(resolve(output, "results.json"), JSON.stringify({ checks: [...checks], issues }, null, 2));
  await browser.close();
}
console.log(`通过${checks.size}项响应检查（重复名称仅计一次），覆盖两个视口。`);
