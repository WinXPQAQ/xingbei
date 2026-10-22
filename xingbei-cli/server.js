import { AI_POLICY_VERSION } from "./src/ai.js";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const assetRoot = join(projectRoot, "assets");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const modelPort = process.env.MODEL_PORT;
const testMode = process.env.TEST_MODE === "1";
// Fetch identity from the actual inference process, never a hand-written UI label.
const modelIdentity = modelPort ? await (async () => {
  const response = await fetch(`http://127.0.0.1:${modelPort}/health`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("模型身份读取失败");
  return response.json();
})() : null;
if (modelIdentity && !['v1.5', 'experimental/hero-foundation-1'].includes(modelIdentity.baseline)) throw new Error('不支持的模型基础策略');
const modelScript = modelIdentity ? `<script>window.XINGBEI_MODEL=true;window.XINGBEI_MODEL_BASELINE=${JSON.stringify(modelIdentity.baseline)};</script>` : '';
const aiLabel = modelIdentity ? modelIdentity.label : AI_POLICY_VERSION.replace(/^v/, "AI ");
const { version } = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
const legacyAssets = JSON.parse(await readFile(join(projectRoot, "legacy-assets.json"), "utf8"));
const types = { ".webm": "video/webm", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

function within(root, suffix) {
  const file = resolve(root, `.${suffix}`);
  return relative(root, file).startsWith("..") ? null : file;
}

function resolveRequest(pathname) {
  if (pathname === "/") return join(projectRoot, "web/index.html");
  if (pathname === "/theme/cardback.png") return join(assetRoot, "theme/style/cardback/image/xingBei1.png");
  if (pathname === "/theme/grid.png") return join(assetRoot, "theme/music/grid.png");
  if (pathname === "/theme/wood3.png") return join(assetRoot, "theme/music/wood3.png");
  if (pathname === "/theme/hp-xingBei1.png") return join(assetRoot, "theme/style/hp/image/xingBei1.png");
  if (pathname === "/theme/hp-xingBei4.png") return join(assetRoot, "theme/style/hp/image/xingBei4.png");
  if (["/training/candidates.mjs", "/training/observation.mjs", "/training/preview.mjs", "/training/teacher.mjs"].includes(pathname)) return within(projectRoot, pathname);
  if (pathname.startsWith("/src/")) return within(projectRoot, pathname);
  if (pathname.startsWith("/web/")) return within(projectRoot, pathname);
  if (pathname.startsWith("/font/")) return within(join(assetRoot, "font"), pathname.slice(5));
  if (pathname.startsWith("/review/")) return within(join(projectRoot, "artifacts/frontend"), `/${legacyAssets[pathname.slice(8)] || pathname.slice(8)}`);
  if (pathname.startsWith("/assets/")) return within(join(assetRoot, "image"), `/${legacyAssets[pathname.slice(8)] || pathname.slice(8)}`);
  return null;
}

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (modelPort && pathname.startsWith('/api/model/')) {
      const route = pathname.slice('/api/model'.length);
      if (!['/health', '/choose'].includes(route)) throw Object.assign(new Error('Not found'), {status:404});
      let body = '', size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 8 * 1024 * 1024) throw new Error('Request too large'); body += chunk; }
      const upstream = await fetch(`http://127.0.0.1:${modelPort}${route}`, {method:request.method, headers:{'Content-Type':'application/json'}, ...(request.method === 'POST' ? {body} : {}), signal:AbortSignal.timeout(30000)});
      response.writeHead(upstream.status, {'Content-Type':'application/json', 'Cache-Control':'no-store'});
      response.end(await upstream.text()); return;
    }
    const filename = resolveRequest(pathname);
    if (!filename) throw Object.assign(new Error("Not found"), { status: 404 });
    const info = await stat(filename);
    if (!info.isFile()) throw Object.assign(new Error("Not found"), { status: 404 });
    const extension = extname(filename);
    const cacheable = [".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif", ".woff2"].includes(extension);
    const headers = { "Content-Type": types[extension] || "application/octet-stream", "Cache-Control": cacheable ? "public, max-age=86400" : "no-store" };
    if (cacheable) {
      headers.ETag = `"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
      headers["Last-Modified"] = info.mtime.toUTCString();
      if (request.headers["if-none-match"]?.split(",").some(tag => tag.trim().replace(/^W\//, "") === headers.ETag || tag.trim() === "*")) {
        response.writeHead(304, headers);
        response.end();
        return;
      }
    }
    response.writeHead(200, headers);
    const content = await readFile(filename);
    if (testMode && (filename === join(projectRoot, "web/index.html") || filename === join(projectRoot, "web/dev.html"))) {
      // Version comes from package.json, not browser state or the scene renderer.
      const label = version.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);
      response.end(content.toString("utf8").replace("<head>", `<head>${modelScript}`).replace("</body>", `<div id="test-version" class="test-version" aria-label="测试版本">测试 ${label}${" + " + aiLabel.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`)}</div>\n</body>`));
    } else response.end(content);
  } catch (error) {
    response.writeHead(error.status || 404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(error.status === 404 ? "Not found" : "Server error");
  }
}).listen(port, host, () => {
  const displayHost = host === "0.0.0.0" ? "<服务器IP>" : host;
  console.log(`星杯传说 Web：http://${displayHost}:${port}（监听 ${host}:${port}）`);
});
