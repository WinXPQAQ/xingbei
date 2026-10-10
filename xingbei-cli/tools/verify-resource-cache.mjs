// Verify HTTP validators and browser disk cache using an isolated temporary profile.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.CURRENT_URL || "http://127.0.0.1:4173";
const resource = `${base}/assets/stones/gem.png`;
const first = await fetch(resource);
assert.equal(first.status, 200);
assert.equal(first.headers.get("cache-control"), "public, max-age=86400");
const etag = first.headers.get("etag");
assert.ok(etag);
assert.ok(first.headers.get("last-modified"));
await first.arrayBuffer();
const validated = await fetch(resource, { headers: { "If-None-Match": etag } });
assert.equal(validated.status, 304);
assert.equal((await validated.arrayBuffer()).byteLength, 0);
const stale = await fetch(resource, { headers: { "If-None-Match": '"old-version"' } });
assert.equal(stale.status, 200);
await stale.arrayBuffer();
for (const path of ["/", "/web/app.js", "/web/original-theme.css"]) {
  const response = await fetch(`${base}${path}`);
  assert.equal(response.headers.get("cache-control"), "no-store");
  await response.arrayBuffer();
}

const profile = await mkdtemp(join(tmpdir(), "xingbei-cache-"));
let context;
const cached = [];
try {
  for (let run = 0; run < 2; run++) {
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      args: process.env.BROWSER_NO_SANDBOX === "1" ? ["--no-sandbox"] : [],
      ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
    });
    const page = await context.newPage();
    const network = await context.newCDPSession(page);
    await network.send("Network.enable");
    network.on("Network.responseReceived", ({ response }) => {
      if (run === 1 && response.fromDiskCache) cached.push(response.url);
    });
    await page.goto(`${base}/web/dev.html?scene=opening`, { waitUntil: "networkidle" });
    await context.close();
    context = null;
  }
  assert.ok(cached.some(url => url.includes("/assets/card/") && !url.includes("/stones/")), "重启浏览器后手牌图片应命中磁盘缓存");
  const result = { base, etag, conditionalStatus: validated.status, diskCachedResources: [...new Set(cached)] };
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(result, null, 2));
  console.log(`HTTP缓存与304校验通过；重启浏览器后${result.diskCachedResources.length}项资源命中本地磁盘缓存。`);
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
