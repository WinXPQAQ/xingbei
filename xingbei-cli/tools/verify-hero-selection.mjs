import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getAvailableHeroes, createHeroRoster } from "../src/hero.js";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const output = resolve(process.argv[2] || "xingbei-cli/artifacts/heroes/selection");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const checks = [], issues = [], heroes = getAvailableHeroes();
const check = (label, value) => { assert.ok(value, label); checks.push(label); };
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, hasTouch: viewport.width < 500 });
    await page.addInitScript(() => { Date.now = () => 13; });
    page.on("pageerror", error => issues.push(error.message));
    page.on("console", message => { if (message.type() === "error") issues.push(message.text()); });
    page.on("response", response => { if (response.status() >= 400) issues.push(response.url()); });
    await page.goto("http://127.0.0.1:4173/?motion=off");
    const tag = `${viewport.width}x${viewport.height}`;
    await page.getByRole("button", { name: "正常游玩", exact: true }).click();
    await page.getByRole("heading", { name: "选择角色" }).waitFor();
    check(`${tag} 选择前不发牌`, await page.locator("#hand .card").count() === 0);
    check(`${tag} 六个角色可选择`, await page.locator("#modal-actions button").count() === 6);
    await page.screenshot({ path: resolve(output, `selection-${tag}.png`) });
    // Restart while a choice is pending must cancel the old selection session.
    await page.getByRole("button", { name: "重新开始", exact: true }).click();
    for (const hero of heroes) {
      await page.getByRole("button", { name: "正常游玩", exact: true }).click();
    await page.getByRole("heading", { name: "选择角色" }).waitFor();
      await page.getByRole("button", { name: hero.name, exact: true }).click();
      await page.waitForFunction(() => document.querySelector("#hint").textContent.includes("[攻击行动]"));
      check(`${tag} ${hero.name}坐到玩家位置`, await page.locator('.player[data-player="0"] .player-name').textContent() === hero.name);
      const names = createHeroRoster(hero.id).map(id => heroes.find(hero => hero.id === id).name);
      check(`${tag} ${hero.name}交换阵容且正常发牌`, (await page.locator(".player-name").allTextContents()).join() === names.join() && await page.locator("#hand .card").count() === 4);
      check(`${tag} ${hero.name}坐次保持`, (await page.locator(".player").evaluateAll(nodes => nodes.map(node => node.dataset.team))).join() === "red,blue,blue,red,red,blue");
      if (hero.id === "guardianAngel") await page.screenshot({ path: resolve(output, `angel-${tag}.png`) });
      await page.getByRole("button", { name: "重新开始", exact: true }).click();
    }
    // Test mode: real rule operations, without exposing a mutable game object.
    await page.getByRole("button", { name: "测试游玩", exact: true }).click();
    await page.getByRole("button", { name: "狂战士", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[data-command="draw"]').disabled);
    check(`${tag} 测试开局公开六人手牌`, await page.locator(".revealed-hand").count() === 6 && await page.locator(".revealed-hand img").count() === 24);
    check(`${tag} 手牌图标沿用状态26px尺寸`, await page.locator(".revealed-hand img").first().evaluate(node => getComputedStyle(node).width === "26px" && getComputedStyle(node).height === "26px"));
    check(`${tag} 命格标记与牌一致且位于右上角`, await page.locator(".revealed-card").evaluateAll(nodes => nodes.every(node => {
      const badge = node.querySelector(".revealed-fate"), img = node.querySelector("img"), rect = node.getBoundingClientRect(), label = badge.getBoundingClientRect();
      return img.alt.includes(`${badge.textContent}命格`) && label.top >= rect.top - 1 && label.right <= rect.right + 1 && getComputedStyle(badge).fontSize === "11px";
    })));
    const initial = await page.locator("#hand .card").count();
    await page.getByRole("button", { name: "摸1张牌", exact: true }).click();
    await page.waitForFunction(count => document.querySelectorAll("#hand .card").length === count + 1, initial);
    check(`${tag} 测试摸牌真实增加一张`, await page.locator('.player[data-player="0"] .revealed-hand img').count() === initial + 1);
    const discard = async (cancel = false) => {
      await page.getByRole("button", { name: "弃一张牌", exact: true }).click();
      await page.locator("#hand .card").first().click();
      if (cancel) await page.getByRole("button", { name: "取消", exact: true }).click();
      else await page.getByRole("button", { name: "确定", exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[data-command="draw"]').disabled);
    };
    await discard(true);
    check(`${tag} 取消测试弃牌不消耗`, await page.locator("#hand .card").count() === initial + 1);
    await discard();
    check(`${tag} 确认测试弃牌消耗一张`, await page.locator("#hand .card").count() === initial);
    check(`${tag} 测试暗弃记录显示属性命格`, (await page.locator("#log .log-entry").allTextContents()).some(line => /暗弃1张手牌（\[.+?\]\[.+?\]/.test(line)));
    for (const team of ["red", "blue"]) {
      const morale = () => page.locator(`#${team}-team td`).first().textContent();
      const before = Number(await morale());
      await page.locator(`[data-command="${team}-minus"]`).click();
      await page.waitForFunction(({team, expected}) => Number(document.querySelector(`#${team}-team td`).textContent) === expected, {team, expected: before - 1});
      await page.locator(`[data-command="${team}-plus"]`).click();
      await page.waitForFunction(({team, expected}) => Number(document.querySelector(`#${team}-team td`).textContent) === expected, {team, expected: before});
      check(`${tag} ${team}士气增减真实生效`, Number(await morale()) === before);
    }
    check(`${tag} 六人手牌图标完整位于视口内`, await page.locator(".revealed-hand img").evaluateAll(nodes => nodes.every(node => { const rect = node.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight; })));
    await page.screenshot({ path: resolve(output, `test-${tag}.png`) });
    const beforeOverflow = Number(await page.locator("#red-team td").first().textContent());
    for (let count = 4; count < 7; count++) {
      await page.getByRole("button", { name: "摸1张牌", exact: true }).click();
      await page.waitForFunction(expected => document.querySelectorAll("#hand .card").length === expected, count + 1);
    }
    check(`${tag} 测试摸牌爆牌仍等待选择`, await page.getByRole("button", { name: "确定", exact: true }).isDisabled() && Number(await page.locator("#red-team td").first().textContent()) === beforeOverflow);
    await page.locator("#hand .card").first().click();
    await page.getByRole("button", { name: "确定", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[data-command="draw"]').disabled);
    check(`${tag} 爆牌确认后暗弃并扣士气`, await page.locator("#hand .card").count() === 6 && Number(await page.locator("#red-team td").first().textContent()) === beforeOverflow - 1);
    for (const repeat of [true, false]) {
      while (await page.locator("#hand .card").count() > 3) await discard();
      await page.getByRole("button", { name: "购买", exact: true }).click();
      await page.getByRole("heading", { name: "你的回合已结束" }).waitFor();
      const turns = await page.locator("#log").textContent();
      check(`${tag} 重复询问前执行回合结束${repeat}`, turns.includes("红一回合结束"));
      await page.getByRole("button", { name: repeat ? "重复回合" : "不重复", exact: true }).click();
      if (repeat) {
        await page.waitForFunction(() => !document.querySelector('[data-command="draw"]').disabled);
        check(`${tag} 重复进入自己新回合`, await page.locator('.player.current').getAttribute("data-player") === "0" && !(await page.locator("#log").textContent()).includes("蓝一回合开始"));
      } else {
        await page.waitForFunction(() => document.querySelector("#log").textContent.includes("蓝一回合开始"));
        check(`${tag} 不重复交给下一位`, (await page.locator("#log").textContent()).includes("蓝一回合开始"));
      }
    }
    // Restart cancels pending responses; mode and hand visibility must not leak.
    await page.getByRole("button", { name: "重新开始", exact: true }).click();
    await page.getByRole("button", { name: "正常游玩", exact: true }).click();
    await page.getByRole("button", { name: "狂战士", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#hint").textContent.includes("[攻击行动]"));
    check(`${tag} 正常模式隐藏公开手牌与测试按钮`, await page.locator(".revealed-hand").count() === 0 && await page.locator(".play-mode-controls").isHidden());
    const normalDraws = (await page.locator("#log .log-entry").allTextContents()).filter(line => line.includes("摸4张牌"));
    check(`${tag} 正常开局摸牌记录不泄露牌面`, normalDraws.length === 6 && normalDraws.every(line => !line.includes("[")));
    for (const motion of ["off", "normal"]) {
      await page.goto(`http://127.0.0.1:4173/?motion=${motion}`);
      await page.getByRole("button", { name: "观战游玩", exact: true }).click();
      await page.getByRole("heading", { name: "为AI选择角色" }).waitFor();
      await page.getByRole("button", { name: "风之剑圣", exact: true }).click();
      await page.locator(".revealed-hand img").first().waitFor();
      await page.getByRole("button", { name: "暂停", exact: true }).click();
      const fingerprint = () => page.locator("#players").innerHTML();
      const frozen = await fingerprint();
      await page.waitForTimeout(400);
      check(`${tag}/${motion} 观战暂停冻结手牌和回合`, await fingerprint() === frozen);
      check(`${tag}/${motion} 0号AI选角且无手动行动`, await page.locator('.player[data-player="0"] .player-name').textContent() === "风之剑圣" && await page.locator("#control").isHidden());
      await page.screenshot({ path: resolve(output, `spectate-${motion}-${tag}.png`) });
      await page.getByRole("button", { name: "继续", exact: true }).click();
      await page.waitForFunction(before => document.querySelector("#players").innerHTML !== before, frozen);
      check(`${tag}/${motion} 继续后自动推进`, await page.locator("#modal").isHidden());
      if (motion === "off") {
        await page.waitForFunction(() => document.querySelector("#log").textContent.includes("蓝三回合结束"));
        check(`${tag} 观战记录同样显示隐藏牌`, (await page.locator("#log .log-entry").allTextContents()).some(line => /摸4张牌（\[/.test(line)));
        const documentLog = await page.locator("#log").textContent();
        check(`${tag} 六个座位均自动完成回合`, ["红一", "蓝一", "蓝二", "红二", "红三", "蓝三"].every(name => documentLog.includes(`${name}回合结束`)) && await page.locator("#modal").isHidden());
      }
      await page.getByRole("button", { name: "暂停", exact: true }).click();
      await page.getByRole("button", { name: "重新开始", exact: true }).click();
      await page.getByRole("heading", { name: "选择游玩模式" }).waitFor();
      check(`${tag}/${motion} 暂停中重开取消等待`, await page.locator("#hand .card").count() === 0 && await page.locator(".revealed-hand").count() === 0);
    }
    await page.close();
  }
  check("控制台及素材错误0", issues.length === 0);
} finally { await writeFile(resolve(output, "results.json"), JSON.stringify({ checks, issues }, null, 2)); await browser.close(); }
console.log(`角色选择：${checks.length}项浏览器检查通过`);
