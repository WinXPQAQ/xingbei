import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const workspaceRoot = normalize(join(projectRoot, ".."));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const testMode = process.env.TEST_MODE === "1";
const { version } = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

function within(root, suffix) {
  const file = resolve(root, `.${suffix}`);
  return relative(root, file).startsWith("..") ? null : file;
}

function resolveRequest(pathname) {
  if (pathname === "/") return join(projectRoot, "web/index.html");
  if (pathname === "/theme/grid.png") return join(workspaceRoot, "xingbei-1.6.7-source/theme/music/grid.png");
  if (pathname === "/theme/wood3.png") return join(workspaceRoot, "xingbei-1.6.7-source/theme/music/wood3.png");
  if (pathname === "/theme/hp-xingBei1.png") return join(workspaceRoot, "xingbei-1.6.7-source/theme/style/hp/image/xingBei1.png");
  if (pathname === "/theme/hp-xingBei4.png") return join(workspaceRoot, "xingbei-1.6.7-source/theme/style/hp/image/xingBei4.png");
  if (pathname.startsWith("/src/")) return within(projectRoot, pathname);
  if (pathname.startsWith("/web/")) return within(projectRoot, pathname);
  if (pathname.startsWith("/font/")) return within(join(workspaceRoot, "xingbei-1.6.7-source/font"), pathname.slice(5));
  if (pathname.startsWith("/review/")) return within(join(projectRoot, "artifacts/frontend"), pathname.slice(7));
  if (pathname.startsWith("/assets/")) return within(join(workspaceRoot, "xingbei-1.6.7-source/image"), pathname.slice(7));
  return null;
}

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
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
      response.end(content.toString("utf8").replace("</body>", `<div id="test-version" class="test-version" aria-label="测试版本">测试 v${label}</div>\n</body>`));
    } else response.end(content);
  } catch (error) {
    response.writeHead(error.status || 404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(error.status === 404 ? "Not found" : "Server error");
  }
}).listen(port, host, () => {
  const displayHost = host === "0.0.0.0" ? "<服务器IP>" : host;
  console.log(`星杯传说 Web：http://${displayHost}:${port}（监听 ${host}:${port}）`);
});
