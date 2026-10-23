import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:4189";
const output = process.env.OUTPUT_DIR || "artifacts/heroes/wave-three";
const heroes = ["assassin", "magicSwordsman", "adjudicator", "sage", "prayer", "heroicPuppet"];
const names = ["暗杀者", "魔剑士", "仲裁者", "贤者", "祈祷师", "英灵人形"];
const checks = [], issues = [];
const check = (label, value) => { assert.ok(value, label); checks.push(label); };
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, hasTouch: viewport.width < 500 });
    page.on("pageerror", (e) => issues.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") issues.push(m.text()); });
    page.on("response", (r) => { if (r.status() >= 400) issues.push(`${r.status()} ${r.url()}`); });
    const click = (name) => page.getByRole("button", { name, exact: true }).click();
    const state = () => page.evaluate(() => window.xingbeiDev.exportState());
    const hand = (index) => page.locator(`#hand .card[data-index="${index}"]`);
    const action = () => page.waitForFunction(() => window.xingbeiDev?.exportState().phase === "action");
    const nextTurn = () => page.waitForFunction(() => window.xingbeiDev.exportState().current === 1);
    for (const hero of heroes) {
      const tag = `${viewport.width} ${hero}`;
      await page.goto(`${base}/web/dev.html?scene=hero-${hero}&motion=off`);
      await action();
      await page.locator(".dev-tools").evaluate((el) => { el.style.visibility = "hidden"; });
      const initial = await state();
      check(`${tag} 六人指定座次`, initial.game.players.map((p) => p.team).join() === "red,blue,blue,red,red,blue");
      check(`${tag} 真实英雄与手牌`, initial.game.players[0].hero.id === hero && initial.game.players[0].hand.length > 0);
      await page.locator('.player[data-player="0"] .avatar').evaluate(async (image) => { await image.decode(); });
      check(`${tag} 原版头像加载`, await page.locator('.player[data-player="0"] .avatar').evaluate((image) => image.naturalWidth > 0));
      const markerKeys = hero === "prayer" ? ["prayerRunes"] : hero === "adjudicator" ? ["judgment"] : hero === "heroicPuppet" ? ["battleRunes", "magicRunes"] : [];
      for (const key of markerKeys) {
        const marker = page.locator(`[data-player="0"] [data-hero-marker="${key}"]`);
        check(`${tag} ${key}数量`, await marker.locator("b").textContent() === String(initial.game.players[0].hero.state[key]));
        await marker.locator("img").evaluate(async (image) => { await image.decode(); });
        check(`${tag} ${key}原图`, await marker.locator("img").evaluate((image) => image.naturalWidth > 0 && getComputedStyle(image).width === "26px"));
      }
      if (hero === "sage") {
        await click("魔道法典");
        await hand(0).click(); await hand(1).click();
        check(`${tag} 同系两牌不能支付异系费用`, await page.getByRole("button", { name: "确认弃置", exact: true }).isDisabled());
        await hand(1).click(); await hand(2).click();
        check(`${tag} 合法两牌可确认`, await page.getByRole("button", { name: "确认弃置", exact: true }).isEnabled());
        await hand(3).click();
        check(`${tag} 可改为三牌且不自动支付`, (await state()).game.players[0].hand.length === 4 && (await state()).pendingChoice.selected.length === 3);
        await click("取消"); await action();
        check(`${tag} 取消保留牌与能量`, (await state()).game.players[0].hand.length === 4 && (await state()).game.players[0].energy.gem === 2);
        await click("魔道法典");
        for (const index of [0, 2, 3]) await hand(index).click();
        await click("确认弃置");
        await page.locator('.player.targetable[data-player="1"]').click();
        await nextTurn();
        const after = await state();
        check(`${tag} 三张费用明弃`, after.game.discard.filter((c) => c.discardVisibility === "public").length === 3);
        check(`${tag} 目标先承受二伤`, after.game.players[1].hand.length === 2 && after.game.players[0].hand.length === 3);
      } else if (hero === "prayer") {
        await click("威力赐福"); await hand(0).click();
        check(`${tag} 选牌未立即结算`, (await state()).game.players[0].hand.length === 3);
        await click("确定");
        check(`${tag} 只选队友且不含自己`, (await state()).legalTargets.join() === "3,4");
        await page.locator('.player.targetable[data-player="3"]').click();
        await click("不发动"); await nextTurn();
        const marker = page.locator('[data-player="3"] [data-effect-id="powerBlessing"]');
        check(`${tag} 威力赐福实体附着`, (await state()).game.players[3].statuses[0].attachment.effectId === "powerBlessing");
        check(`${tag} 威字标记`, await marker.locator("b").textContent() === "威");
        await marker.locator("img").evaluate(async (image) => { await image.decode(); });
        check(`${tag} 基础效果牌面加载`, await marker.locator("img").evaluate((image) => image.naturalWidth > 0));
      } else if (hero === "heroicPuppet") {
        await hand(0).click(); await page.locator('.player.targetable[data-player="1"]').click();
        await click("不发动");
        await page.waitForFunction(() => window.xingbeiDev.exportState().pendingChoice?.title.includes("战纹碎击"));
        await hand(0).click(); await hand(2).click();
        check(`${tag} 异系组合不能支付碎击`, await page.getByRole("button", { name: "确认弃置", exact: true }).isDisabled());
        await hand(2).click(); await hand(1).click();
        check(`${tag} 同系费用待确认`, (await state()).game.players[0].hand.length === 5 && await page.getByRole("button", { name: "确认弃置", exact: true }).isEnabled());
        await click("确认弃置"); await click("不发动"); await nextTurn();
        const after = await state();
        check(`${tag} 翻转守恒`, after.game.players[0].hero.state.battleRunes === 1 && after.game.players[0].hero.state.magicRunes === 2);
        check(`${tag} 碎击三伤`, after.game.players[1].hand.length === 3);
        check(`${tag} 数量重绘`, await page.locator('[data-player="0"] [data-hero-marker="magicRunes"] b').textContent() === "2");
      }
      await page.screenshot({ path: `${output}/${viewport.width}-${hero}.png` });
    }
    await page.goto(`${base}/?motion=off`);
    await click("正常游玩");
    const available = await page.evaluate(async () => (await import('/src/hero.js')).getAvailableHeroes());
    check(`${viewport.width} 18英雄已注册`, available.length === 18);
    for (const name of names) check(`${viewport.width} 可选${name}`, await page.getByRole("button", { name, exact: true }).count() === 1);
    await click("英灵人形");
    await page.waitForFunction(() => document.querySelectorAll("#hand .card").length === 4);
    check(`${viewport.width} 正常开局6人`, await page.locator(".player").count() === 6);
    await page.close();
  }
  check("无控制台或素材错误", issues.length === 0);
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, issues }, null, 2));
  await browser.close();
}
console.log(`${checks.length} checks passed`);
