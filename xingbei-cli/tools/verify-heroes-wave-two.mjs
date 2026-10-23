import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const base = process.env.BASE_URL || "http://127.0.0.1:4186";
const output = "artifacts/heroes/wave-two";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const checks = [],
  issues = [];
const check = (name, value) => {
  assert.ok(value, name);
  checks.push(name);
};
try {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({
      viewport,
      hasTouch: viewport.width < 500,
    });
    page.on("pageerror", (e) => issues.push(e.message));
    page.on("console", (message) => { if (message.type() === "error") issues.push(message.text()); });
    page.on("response", (r) => {
      if (r.status() >= 400) issues.push(`${r.status()} ${r.url()}`);
    });
    const click = (name) =>
      page.getByRole("button", { name, exact: true }).click();
    const state = () => page.evaluate(() => window.xingbeiDev.exportState());
    for (const hero of [
      "saint",
      "holyLancer",
      "plagueMage",
      "elementalist",
      "valkyrie",
      "magicalGirl",
    ]) {
      const tag = `${viewport.width} ${hero}`;
      await page.goto(`${base}/web/dev.html?scene=hero-${hero}&motion=off`);
      await page.waitForFunction(
        () => window.xingbeiDev?.exportState().phase === "action",
      );
      check(
        `${tag} 六人坐次`,
        (await state()).game.players.map((p) => p.team).join() ===
          "red,blue,blue,red,red,blue",
      );
      check(
        `${tag} 英雄正确`,
        (await state()).game.players[0].hero.id === hero,
      );
      await page
        .locator(".dev-tools")
        .evaluate((el) => (el.style.visibility = "hidden"));
      if (hero === "holyLancer") {
        await click("辉耀");
        await page.locator('#hand .card[data-index="0"]').click();
        await click("确定");
        await page.waitForFunction(
          () => window.xingbeiDev.exportState().phase === "action",
        );
        check(
          `${tag} 全员治疗`,
          (await state()).game.players.every((p) => p.healing >= 1),
        );
        check(
          `${tag} 明弃费用`,
          (await state()).game.discard[0].discardVisibility === "public",
        );
      } else if (hero === "elementalist") {
        await click("元素点燃");
        await page.locator('.player.targetable[data-player="1"]').click();
        await page.waitForFunction(
          () => window.xingbeiDev.exportState().phase === "action",
        );
        check(
          `${tag} 元素耗尽`,
          (await state()).game.players[0].hero.state.elements === 0,
        );
        check(
          `${tag} 额外法术`,
          (await state()).game.turn.pendingActions.some(
            (a) => a.type === "spell",
          ),
        );
      } else if (hero === "valkyrie") {
        await click("秩序之印");
        await page.getByRole("button", { name: "发动", exact: true }).waitFor();
        await click("发动");
        await page.waitForFunction(
          () => window.xingbeiDev.exportState().phase === "action",
        );
        check(
          `${tag} 直接摸牌`,
          (await state()).game.players[0].hand.length === 5,
        );
        check(
          `${tag} 保留额外行动`,
          (await state()).game.turn.pendingActions.length === 1,
        );
      } else if (hero === "magicalGirl") {
        await page.locator('#hand .card[data-index="2"]').click();
        check(
          `${tag} 两个方向`,
          (await page.locator(".player.targetable").count()) === 2,
        );
        await page.locator("#cancel-target").click();
        check(`${tag} 取消不出牌`, (await state()).game.field.length === 0);
        await page.locator('#hand .card[data-index="2"]').click();
        await page.locator('.player.targetable[data-player="5"]').click();
        await page.waitForFunction(
          () => window.xingbeiDev.exportState().current === 1,
        );
        check(
          `${tag} 逆向目标`,
          (await state()).game.players[5].hand.length === 2,
        );
      } else if (hero === "plagueMage") {
        await click("剧毒新星");
        await click("不发动");
        await page.waitForFunction(
          () => window.xingbeiDev.exportState().current === 1,
        );
        check(
          `${tag} 所有其他人受伤摸牌`,
          (await state()).game.players
            .slice(1)
            .every((p) => p.hand.length === 2),
        );
      } else if (hero === "saint") {
        await click("圣疗");
        await click("1人");
        await page.locator('.player.targetable[data-player="0"]').click();
        await click("不发动");
        await click("0宝石 1水晶");
        await click("法术行动");
        await page.waitForFunction(
          () => window.xingbeiDev.exportState().phase === "action",
        );
        check(
          `${tag} 圣疗一次`,
          (await page
            .getByRole("button", { name: "圣疗", exact: true })
            .count()) === 0,
        );
        check(
          `${tag} 额外法术`,
          (await state()).game.turn.pendingActions.some(
            (a) => a.type === "spell",
          ),
        );
      }
      await page.screenshot({
        path: `${output}/${viewport.width}-${hero}.png`,
      });
    }
    await page.goto(`${base}/?motion=off`);
    await click("正常游玩");
    for (const name of [
      "圣女",
      "圣枪骑士",
      "瘟疫法师",
      "元素师",
      "女武神",
      "魔法少女",
    ])
      check(
        `${viewport.width} 可选${name}`,
        (await page.getByRole("button", { name, exact: true }).count()) === 1,
      );
    await click("元素师");
    await page.waitForFunction(
      () => document.querySelectorAll("#hand .card").length === 4,
    );
    check(
      `${viewport.width} 六人开局`,
      (await page.locator(".player").count()) === 6,
    );
    await page.close();
  }
  check("无浏览器及HTTP错误", issues.length === 0);
} finally {
  await writeFile(
    `${output}/results.json`,
    JSON.stringify({ checks, issues }, null, 2),
  );
  await browser.close();
}
console.log(`${checks.length} checks passed`);
