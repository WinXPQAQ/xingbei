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
    await page.screenshot({ path: resolve(output, `${tag}.png`) });
    await page.close();
  }
  check("控制台和素材错误0", issues.length === 0);
} finally { await writeFile(resolve(output, "results.json"), JSON.stringify({ hero, checks, issues }, null, 2)); await browser.close(); }
console.log(`${hero}: ${checks.length}项浏览器检查通过`);
