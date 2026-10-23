import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const base = process.env.BASE_URL || "http://127.0.0.1:4193",
  output = "artifacts/heroes/magic-fusion-response";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] }),
  checks = [],
  issues = [];
const check = (name, value) => {
  assert.ok(value, name);
  checks.push(name);
};
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 900 },
      hasTouch: width === 390,
    });
    page.on("pageerror", (e) => issues.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") issues.push(m.text());
    });
    const state = () => page.evaluate(() => window.xingbeiDev.exportState());
    const click = (name) =>
      page.getByRole("button", { name, exact: true }).click();
    await page.goto(`${base}/web/dev.html?scene=magic-fusion-human&motion=off`);
    await page.waitForFunction(() => !!window.xingbeiDev);
    await click("单步 AI");
    await page.getByRole("button", { name: "不响应", exact: true }).waitFor();
    check(
      `${width} 融合技能进入人类响应`,
      (await state()).game.players[0].hand.length === 6 &&
        (await state()).game.field.length === 1,
    );
    check(
      `${width} 未提交不扣士气`,
      (await state()).game.teams.red.morale === 15,
    );
    await page.locator('#hand .card[data-index="0"]').click();
    await page.getByRole("button", { name: "确认", exact: true }).waitFor();
    check(
      `${width} 圣光待确认`,
      (await state()).game.players[0].hand.length === 6,
    );
    await page.locator('#hand .card[data-index="0"]').click();
    check(
      `${width} 可撤回选牌`,
      await page
        .getByRole("button", { name: "不响应", exact: true })
        .isVisible(),
    );
    await page.locator('#hand .card[data-index="0"]').click();
    await click("确认");
    await page.waitForFunction(
      () => window.xingbeiDev.exportState().current === 2,
    );
    check(
      `${width} 圣光抵消且场上清理`,
      (await state()).game.players[0].hand.length === 5 &&
        (await state()).game.field.length === 0 &&
        (await state()).game.teams.red.morale === 15,
    );
    await page.screenshot({ path: `${output}/${width}-human.png` });
    await page.goto(`${base}/web/dev.html?scene=magic-fusion-ai&motion=off`);
    await page.waitForFunction(
      () => window.xingbeiDev?.exportState().phase === "action",
    );
    await click("魔弹融合");
    await page.locator('#hand .card[data-index="0"]').click();
    await click("确定");
    await page.locator('.player.targetable[data-player="1"]').click();
    await page.waitForFunction(
      () => window.xingbeiDev.exportState().current === 1,
    );
    const after = await state();
    check(
      `${width} 满手AI用圣光`,
      after.game.players[1].hand.length === 5 &&
        after.game.discard.some((c) => c.name === "holyLight"),
    );
    check(
      `${width} AI不损士气且实体清理`,
      after.game.teams.blue.morale === 15 && after.game.field.length === 0,
    );
    await page.screenshot({ path: `${output}/${width}-ai.png` });
    await page.close();
  }
  check("无控制台错误", issues.length === 0);
} finally {
  await writeFile(
    `${output}/results.json`,
    JSON.stringify({ checks, issues }, null, 2),
  );
  await browser.close();
}
console.log(`${checks.length} fusion response checks passed`);
