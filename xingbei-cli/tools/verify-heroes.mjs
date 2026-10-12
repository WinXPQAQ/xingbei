import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const hero = process.argv[2] || "berserker", output = resolve(process.argv[3] || `xingbei-cli/artifacts/heroes/${hero}`);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const checks = [], issues = [];
const check = (name, value) => { assert.ok(value, name); checks.push(name); };
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, hasTouch: viewport.width < 500 });
    page.on("pageerror", error => issues.push(error.message));
    page.on("console", message => { if (message.type() === "error") issues.push(message.text()); });
    page.on("response", response => { if (response.status() >= 400) issues.push(`${response.status()} ${response.url()}`); });
    await page.goto(`http://127.0.0.1:4173/web/dev.html?scene=hero-${hero}`);
    await page.waitForFunction(() => window.xingbeiDev?.exportState().phase === "action");
    await page.locator(".dev-tools").evaluate(toolbar => { toolbar.style.visibility = "hidden"; });
    const state = () => page.evaluate(() => window.xingbeiDev.exportState());
    const tag = `${viewport.width}x${viewport.height}`;
    check(`${tag} 六人坐次`, (await state()).game.players.map(player => player.team).join() === "red,blue,blue,red,red,blue");
    check(`${tag} 玩家英雄`, (await state()).game.players[0].hero.id === hero);
    if (hero === "berserker") {
      await page.locator('#hand .card[data-index="0"]').click();
      check(`${tag} 待提交可取消`, (await state()).game.field.length === 0);
      await page.locator("#cancel-target").click();
      check(`${tag} 取消未移动实体`, (await state()).game.players[0].hand.length === 2);
      await page.locator('#hand .card[data-index="0"]').click();
      await page.locator('.player.targetable[data-player="1"]').click();
      await page.waitForFunction(() => window.xingbeiDev.exportState().pendingChoice?.title.includes("血腥咆哮"));
      await page.getByRole("button", { name: "发动", exact: true }).click();
      await page.waitForFunction(() => window.xingbeiDev.exportState().pendingChoice?.title.includes("撕裂"));
      check(`${tag} 撕裂在时点2命中后且早于伤害时点3询问`, (await state()).game.timeline.at(-1).timing === "attackHit" && (await state()).game.timeline.at(-1).point === 2 && !(await state()).game.timeline.some(entry => entry.timing === "damageBefore"));
      await page.getByRole("button", { name: "不发动", exact: true }).click();
      await page.waitForFunction(() => window.xingbeiDev.exportState().current === 1);
      const after = await state();
      check(`${tag} 圣盾保留`, after.game.players[1].statuses.some(card => card.attachment.effectId === "holyShield"));
      check(`${tag} 时点4治疗正常使用`, after.game.players[1].healing === 0 && after.log.some(entry => entry.line.includes("承受1点攻击伤害")));
      check(`${tag} 拒绝撕裂不扣费`, after.game.players[0].energy.gem === 1);
      check(`${tag} 六时点存在`, [1,2,3,4,5,6].every(point => after.game.timeline.some(entry => entry.point === point)));
    }
    if (hero === "windSwordmaster") {
      await page.locator('#hand .card[data-index="0"]').click(); await page.locator('.player.targetable[data-player="1"]').click();
      for (const title of ["疾风技", "风怒追击", "剑影"]) {
        await page.waitForFunction(title => window.xingbeiDev.exportState().pendingChoice?.title.includes(title), title);
        await page.getByRole("button", { name: "发动", exact: true }).click();
      }
      await page.waitForFunction(() => window.xingbeiDev.exportState().phase === "action");
      check(`${tag} 额外行动留在本回合`, (await state()).current === 0 && (await state()).game.turn.pendingActions.length === 3);
      check(`${tag} 风系限制`, await page.locator('#hand .card[data-index="1"]').isDisabled());
      check(`${tag} 剑影费用`, (await state()).game.players[0].energy.crystal === 0);
      await page.getByRole("button", { name: "结束回合", exact: true }).click();
      await page.waitForFunction(() => window.xingbeiDev.exportState().current === 1);
      check(`${tag} 可以放弃所有额外行动`, (await state()).game.players[0].hand.length === 2);
    }
    if (hero === "marksman") {
      await page.getByRole("button", { name: "狙击", exact: true }).click();
      check(`${tag} 目标提交前不扣费`, (await state()).game.players[0].energy.crystal === 1);
      await page.locator("#cancel-target").click();
      await page.getByRole("button", { name: "狙击", exact: true }).click();
      await page.locator('.player.targetable[data-player="0"]').click();
      await page.waitForFunction(() => window.xingbeiDev.exportState().pendingChoice?.title.startsWith("爆牌"));
      check(`${tag} 补到5且等待暗弃`, (await state()).game.players[0].hand.length === 5);
      await page.locator('#hand .card[data-index="0"]').click();
      await page.getByRole("button", { name: "确定", exact: true }).click();
      await page.waitForFunction(() => window.xingbeiDev.exportState().phase === "action");
      const after = await state();
      check(`${tag} 狙击非伤害`, !after.game.timeline.some(entry => entry.timing === "damageBefore"));
      check(`${tag} 暗弃和士气`, after.game.discard[0].discardVisibility === "hidden" && after.game.teams.red.morale === 14);
      check(`${tag} 保留额外攻击`, after.game.turn.pendingActions.length === 1);
      await page.getByRole("button", { name: "结束回合", exact: true }).click();
      await page.waitForFunction(() => window.xingbeiDev.exportState().current === 1);
    }
    if (hero === "sealer") {
      check(`${tag} 唯一专属牌在场外`, (await state()).game.outside.length === 1);
      await page.getByRole("button", { name: "火之封印", exact: true }).click();
      await page.locator('#hand .card[data-index="0"]').click();
      await page.getByRole("button", { name: "确定", exact: true }).click();
      check(`${tag} 挂载前可取消`, (await state()).game.players[0].hand.length === 2);
      await page.locator('.player.targetable[data-player="1"]').click();
      await page.waitForFunction(() => window.xingbeiDev.exportState().pendingChoice?.title === "法术激荡");
      await page.getByRole("button", { name: "不发动", exact: true }).click();
      await page.waitForFunction(() => window.xingbeiDev.exportState().current === 1);
      const after = await state();
      check(`${tag} 实际牌挂载`, after.game.players[1].statuses[0].attachment.effectId === "fireSeal" && after.game.field.length === 0);
      check(`${tag} 基础效果标记显示`, await page.locator('.player[data-player="1"] img[alt="火之封印"]').count() === 1);
    }
    if (hero === "guardianAngel") {
      await page.getByRole("button", { name: "天使之墙", exact: true }).click();
      await page.locator('#hand .card[data-index="0"]').click();
      await page.getByRole("button", { name: "确定", exact: true }).click();
      check(`${tag} 墙待目标不移动牌`, (await state()).game.players[0].hand.length === 2);
      await page.locator('.player.targetable[data-player="1"]').click();
      await page.waitForFunction(() => window.xingbeiDev.exportState().pendingChoice?.title.includes("天使羁绊"));
      check(`${tag} 羁绊选择期间墙已显示圣盾图标`, await page.locator('.player[data-player="1"] .marks img[alt="圣盾"]').count() === 1);
      check(`${tag} 羁绊直接高亮角色且没有选项弹窗`, await page.locator(".player.targetable").count() === 6 && await page.locator("#modal").isHidden());
      await page.locator('.player.targetable[data-player="0"]').click();
      await page.waitForFunction(() => window.xingbeiDev.exportState().current === 1);
      const after = await state();
      check(`${tag} 墙成为实际基础圣盾`, after.game.players[1].statuses.some(card => card.attachment.effectId === "holyShield" && card.type === "attack"));
      check(`${tag} 墙使用已加载的圣盾图标`, await page.locator('.player[data-player="1"] .marks img[alt="圣盾"]').evaluate(image => image.getAttribute("src") === "/assets/card/holyShield.png" && image.complete && image.naturalWidth > 0));
      check(`${tag} 羁绊给治疗`, after.game.players[0].healing === 1);
      check(`${tag} 保留其他基础效果`, after.game.players[1].statuses.some(card => card.attachment.effectId === "poison"));
    }
    if (hero === "priest") {
      check(`${tag} 神官6治疗槽`, await page.locator('.player[data-player="0"] .hp > span').count() === 6);
      await page.getByRole("button", { name: "神圣祈福", exact: true }).click();
      await page.locator('#hand .card[data-index="0"]').click(); await page.locator('#hand .card[data-index="1"]').click();
      check(`${tag} 费用选牌仍未提交`, (await state()).game.players[0].hand.length === 3);
      await page.getByRole("button", { name: "确认弃置", exact: true }).click();
      await page.waitForFunction(() => window.xingbeiDev.exportState().pendingChoice?.title === "神圣契约");
      await page.getByRole("button", { name: "不发动", exact: true }).click();
      await page.waitForFunction(() => window.xingbeiDev.exportState().current === 1);
      check(`${tag} 祈福上限6及明弃`, (await state()).game.players[0].healing === 6 && (await state()).game.discard.every(card => card.discardVisibility === "public"));
      await page.goto(`http://127.0.0.1:4173/web/dev.html?scene=hero-priest`);
      await page.waitForFunction(() => window.xingbeiDev?.exportState().phase === "action");
    await page.locator(".dev-tools").evaluate(toolbar => { toolbar.style.visibility = "hidden"; });
      await page.locator('#hand .card[data-index="2"]').click(); await page.locator('.player.targetable[data-player="1"]').click();
      await page.waitForFunction(() => window.xingbeiDev.exportState().pendingChoice?.title === "神圣契约");
      await page.getByRole("button", { name: "发动", exact: true }).click();
      check(`${tag} 契约只允许直接选择队友`, await page.locator(".player.targetable").count() === 2 && await page.locator("#modal").isHidden());
      await page.locator('.player[data-player="0"]').evaluate(node => node.click());
      check(`${tag} 契约非法目标不推进`, (await state()).pendingChoice.type === "target");
      await page.locator('.player.targetable[data-player="3"]').click();
      await page.getByRole("button", { name: "4点", exact: true }).click();
      await page.waitForFunction(() => window.xingbeiDev.exportState().current === 1);
      const after = await state();
      check(`${tag} 契约转移突破普通上限`, after.game.players[3].healing === 4 && after.game.players[0].healing === 0);
      check(`${tag} 超上限槽完整显示`, await page.locator('.player[data-player="3"] .hp > span').count() === 4);
      check(`${tag} 启动仅一次及扣费`, after.game.timeline.filter(entry => entry.timing === "activation").length === 1 && after.game.players[0].energy.crystal === 0);
    }
    await page.waitForFunction(() => !window.xingbeiDev.animations().playing && window.xingbeiDev.animations().active === 0);
    await page.screenshot({ path: resolve(output, `${tag}.png`) });
    if (hero === "priest") {
      await page.addInitScript(() => { Date.now = () => 13; });
      await page.goto("http://127.0.0.1:4173/?motion=off");
      await page.getByRole("button", { name: "狂战士", exact: true }).click();
      await page.waitForFunction(() => document.querySelector("#hint").textContent.includes("[攻击行动]"));
      check(`${tag} 正式页面六英雄阵容`, (await page.locator(".player-name").allTextContents()).join() === "狂战士,风之剑圣,神箭手,封印师,守护天使,神官");
      check(`${tag} 正式六人开局手牌`, await page.locator("#hand .card").count() === 4);
      const ids = await page.locator("#hand .card").evaluateAll(nodes => nodes.map(node => node.dataset.cardId).join());
      await page.locator("#hand .card:not(.unusable):enabled").first().click();
      check(`${tag} 正式选牌高亮目标`, await page.locator(".player.targetable").count() > 0);
      await page.locator("#cancel-target").click();
      check(`${tag} 正式取消保留牌`, await page.locator("#hand .card").evaluateAll(nodes => nodes.map(node => node.dataset.cardId).join()) === ids);
      await page.screenshot({ path: resolve(output, `default-${tag}.png`) });
    }
    await page.close();
  }
  check("控制台和素材错误0", issues.length === 0);
} finally { await writeFile(resolve(output, "results.json"), JSON.stringify({ hero, checks, issues }, null, 2)); await browser.close(); }
console.log(`${hero}: ${checks.length}项浏览器检查通过`);
