// Development-only audit. Does not modify either application or its saved data.
import { createRequire } from "node:module";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = resolve(projectRoot, "../xingbei-1.6.7-source");
const originalURL = process.env.ORIGINAL_URL || "http://127.0.0.1:4180";
const currentURL = process.env.CURRENT_URL || "http://127.0.0.1:4181";
const output = resolve(process.argv[2] || resolve(projectRoot, "artifacts/frontend/p0", new Date().toISOString().replaceAll(":", "-")));
const seed = 20260905;
const viewport = { width: 1440, height: 900 };
for (const address of [originalURL, currentURL]) {
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(address).hostname)) {
    throw new Error("Baseline capture must use local project servers");
  }
}
await mkdir(output, { recursive: true });
// Refuse to replace a previous run: reference evidence must remain reviewable.
await writeFile(resolve(output, "run.json"), JSON.stringify({ seed, viewport, originalURL, currentURL, startedAt: new Date().toISOString() }, null, 2), { flag: "wx" });

const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
  ...(process.env.BROWSER_NO_SANDBOX === "1" ? { args: ["--no-sandbox"] } : {}),
});
const captures = [];
const logs = {};
const resources = new Set();

async function open(name, url) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, locale: "zh-CN", timezoneId: "UTC" });
  page.setDefaultTimeout(15000);
  logs[name] = [];
  const record = entry => logs[name].push({ ...entry, sequence: logs[name].length + 1 });
  page.on("pageerror", error => record({ kind: "pageerror", text: error.message }));
  page.on("console", message => {
    if (["error", "warning"].includes(message.type())) record({ kind: message.type(), text: message.text() });
  });
  page.on("requestfailed", request => record({ kind: "requestfailed", url: request.url(), error: request.failure() }));
  page.on("response", response => {
    if (name === "original") resources.add(response.url());
    if (response.status() >= 400) record({ kind: "http", status: response.status(), url: response.url() });
  });
  page.on("dialog", async dialog => {
    record({ kind: "dialog", type: dialog.type(), text: dialog.message() });
    // Only acknowledge the local startup notice. Do not accept reset/update prompts.
    if (dialog.message().startsWith("欢迎来到《星杯传说》")) await dialog.accept();
    else await dialog.dismiss();
  });
  await page.addInitScript(({ seed, original }) => {
    if (original) {
      let state = seed;
      Math.random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    } else {
      // The current app seeds its Game from Date.now(). This override is confined
      // to this isolated browser context; production code stays untouched.
      Date.now = () => seed;
    }
  }, { seed, original: name === "original" });
  await page.goto(url, { waitUntil: "load" });
  return page;
}

async function capture(page, id, label, original) {
  await page.evaluate(() => document.fonts.ready);
  // Wait for the original's entrance transitions, not for network idle (some
  // pages may connect to remote services). Events are captured in a waiting state.
  await page.waitForTimeout(900);
  // Finish finite CSS transitions before measuring so JSON and PNG describe
  // the same layout (the original control bar animates its vertical position).
  await page.screenshot({ path: resolve(output, `${id}.png`), animations: "disabled" });
  const state = await page.evaluate(async original => {
    const selectors = original
      ? ["html", "body", "#window", "#system", "#arena", "#arena > .player", "#me", "#mebg", "#handcards1", "#handcards1 .card", "#control", ".zhanJi", "#arenalog", "#historybar", ".dialog", ".menu-container"]
      : ["html", "body", ".game-shell", ".topbar", ".scoreboard", ".board", ".player", ".hand-zone", ".hand", ".hand .card", ".actions", ".log-panel", ".modal", ".dialog"];
    const properties = ["display", "visibility", "position", "left", "top", "width", "height", "transform", "fontFamily", "fontSize", "color", "backgroundImage", "backgroundSize", "borderRadius", "boxShadow", "zIndex", "overflow", "opacity"];
    const geometry = Object.fromEntries(selectors.map(selector => [selector, [...document.querySelectorAll(selector)].map(node => {
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      return { className: node.className, dataset: { ...node.dataset }, text: node.innerText?.slice(0,300), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, style: Object.fromEntries(properties.map(key => [key, style[key]])) };
    })]));
    let gameState = null;
    if (original) {
      const { lib, game, ui, _status } = await import("/noname.js");
      const keys = ["mode", "theme", "layout", "card_style", "cardback_style", "hp_style", "image_background", "ui_zoom", "name_font", "identity_font", "card_font", "cardtext_font", "global_font", "player_height", "player_height_nova", "show_log", "show_history", "fold_card", "touchscreen", "animation", "glow_phase"];
      gameState = {
        config: Object.fromEntries(keys.map(key => [key, lib.config[key]])), modeConfig: lib.config.mode_config,
        documentZoom: game.documentZoom, deviceZoom: game.deviceZoom, layout: game.layout,
        event: { name: _status.event?.name, step: _status.event?.step },
        me: game.me?.name, selectedCards: ui.selected.cards.map(card => card.name),
        players: game.players.map(player => ({ name: player.name, position: player.dataset.position, side: player.side, hand: player.getCards("h").map(card => ({ name: card.name, nature: card.nature, type: card.type, text: card.innerText })) })),
        teams: { red: { morale: game.hongShiQi, cups: game.hongXingBei, stones: game.hongZhanJi }, blue: { morale: game.lanShiQi, cups: game.lanXingBei, stones: game.lanZhanJi } },
      };
    }
    return {
      url: location.href, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      userAgent: navigator.userAgent, fonts: [...document.fonts].map(font => ({ family: font.family, status: font.status })),
      stylesheets: [...document.styleSheets].map(sheet => sheet.href || "inline"),
      geometry, gameState, text: document.body.innerText,
      images: [...document.images].map(image => ({ src: image.currentSrc || image.src, complete: image.complete, width: image.naturalWidth })),
    };
  }, original);
  await writeFile(resolve(output, `${id}.json`), JSON.stringify(state, null, 2));
  await writeFile(resolve(output, `${id}.html`), await page.content());
  captures.push({ id, label, original });
  console.log(`Captured ${id}: ${label}`);
}

try {
  const original = await open("original", originalURL);
  await original.getByText("跳过向导", { exact: true }).waitFor();
  await capture(original, "original-tutorial", "首次启动 / 新手向导", true);
  await original.getByText("跳过向导", { exact: true }).click();
  await original.locator(".dialog .button.character").first().waitFor();
  await capture(original, "original-character", "四人局 / 选角", true);
  await original.locator(".dialog .tdnode").first().click();
  const character = original.locator(".dialog .button.character").filter({ hasText: "狂战士" });
  await character.click();
  await original.waitForFunction(async () => {
    const { game, _status } = await import("/noname.js");
    return game.me?.name === "kuangZhanShi" && _status.event?.name === "gongJiOrFaShu" && game.me.countCards("h") === 4;
  });
  await capture(original, "original-S01", "S01 / 四人开局，等待本人行动", true);
  await original.locator("#handcards1 .card").first().click();
  await original.waitForFunction(async () => (await import("/noname.js")).ui.selected.cards.length === 1);
  await capture(original, "original-S03", "S03 / 选牌，等待选择目标", true);
  // Deselect without submitting an action or advancing the reference game.
  await original.locator("#handcards1 .card").first().click();
  await original.waitForFunction(async () => (await import("/noname.js")).ui.selected.cards.length === 0);
  await original.locator("#system").getByText("选项", { exact: true }).click();
  await original.locator(".menu-container:not(.hidden)").waitFor();
  await capture(original, "original-menu", "菜单 / 开始与模式入口", true);

  const current = await open("current", currentURL);
  await current.locator("#hand .card:enabled").first().waitFor();
  await capture(current, "current-S01", "新版 / 四人开局（同视口，规则与牌序尚未统一）", false);
  const firstCard = current.locator("#hand .card:not(.unusable)").first();
  await firstCard.click();
  await current.locator(".player.targetable").first().waitFor();
  await capture(current, "current-S03", "新版 / 选牌目标提示", false);

  const manifest = [];
  for (const address of [...resources].sort()) {
    const url = new URL(address);
    if (url.origin !== new URL(originalURL).origin || url.search) continue;
    const file = resolve(sourceRoot, `.${decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)}`);
    if (relative(sourceRoot, file).startsWith("..")) continue;
    try {
      const bytes = await readFile(file);
      manifest.push({ path: relative(sourceRoot, file), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    } catch { manifest.push({ path: relative(sourceRoot, file), missing: true }); }
  }
  await writeFile(resolve(output, "source-resources.json"), JSON.stringify(manifest, null, 2));
  await writeFile(resolve(output, "captures.json"), JSON.stringify({ browser: browser.version(), captures }, null, 2));
  await writeFile(resolve(output, "compare.html"), comparisonHTML());
} catch (error) {
  await writeFile(resolve(output, "failure.txt"), error.stack || String(error));
  throw error;
} finally {
  await writeFile(resolve(output, "issues.json"), JSON.stringify(logs, null, 2));
  await browser.close();
}

function comparisonHTML() {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>P0 前端基准对比</title>
<style>body{margin:24px;background:#202124;color:#eee;font:16px system-ui}a{color:#9cd5ff}label{display:inline-block;margin:12px 24px 12px 0}select{font:inherit}#frame{position:relative;width:100%;aspect-ratio:1440/900;background:#333;overflow:hidden}#frame img{position:absolute;width:100%;height:100%;inset:0}#old{clip-path:inset(0 50% 0 0)}#line{position:absolute;left:50%;height:100%;border-left:2px solid #fff}input{width:240px}li{margin:8px 0}</style>
<h1>P0：原版与重构版</h1><p>左侧原版，右侧重构版。1440×900，DPR 1。拖动分界线查看布局差异。</p>
<p>这是结构对照：双方角色、牌序及规则能力尚未统一，不能将全屏像素差作为还原通过率。原版内部缩放和实际配置见对应 JSON。</p>
<label>场景 <select id="scene"><option value="S01">四人开局</option><option value="S03">选牌与目标提示</option></select></label>
<label>原版覆盖比例 <input id="split" type="range" min="0" max="100" value="50"></label>
<div id="frame"><img id="new" src="current-S01.png" alt="重构版"><img id="old" src="original-S01.png" alt="原版"><div id="line"></div></div>
<p>原始截图、尺寸及状态证据：</p><ul>${captures.map(c => `<li>${c.label}：<a href="${c.id}.png">截图</a> · <a href="${c.id}.json">状态与测量</a> · <a href="${c.id}.html" download>DOM 快照（下载）</a></li>`).join("")}</ul>
<p><a href="issues.json">加载问题</a> · <a href="source-resources.json">原版资源及内容哈希</a></p>
<script>const old=document.getElementById('old'),current=document.getElementById('new'),split=document.getElementById('split');split.oninput=()=>{old.style.clipPath='inset(0 '+(100-split.value)+'% 0 0)';document.getElementById('line').style.left=split.value+'%'};document.getElementById('scene').onchange=e=>{old.src='original-'+e.target.value+'.png';current.src='current-'+e.target.value+'.png'};</script></html>`;
}
