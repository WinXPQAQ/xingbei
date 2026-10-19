// Linux/systemd deployment helper. Never runs git pull/reset in a development checkout.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, renameSync, symlinkSync, readlinkSync, rmSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

const args = process.argv.slice(2);
const configPath = process.env.XINGBEI_DEPLOY_CONFIG || join(homedir(), ".config/xingbei-deploy/config.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const root = resolve(config.root || join(homedir(), ".local/share/xingbei-deploy"));
const service = config.service || "xingbei-web.service";
const branch = config.branch || "main";
const baseUrl = config.healthUrl || "http://127.0.0.1:4173";
const repository = join(root, "repository.git"), releases = join(root, "releases");
const current = join(root, "current"), failed = join(root, "failed.json");
mkdirSync(root, { recursive: true });

function run(command, params, options = {}) {
  const result = spawnSync(command, params, { encoding: "utf8", timeout: 180_000, maxBuffer: 10 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message || result.stderr || result.stdout || result.status}`);
  return result.stdout?.trim() || "";
}
function target() {
  try { return resolve(root, readlinkSync(current)); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
function metadata(directory) { return directory ? JSON.parse(readFileSync(join(directory, ".deployment.json"), "utf8")) : null; }
function switchTo(directory) {
  const temporary = join(root, `.current-${process.pid}`);
  symlinkSync(directory, temporary);
  renameSync(temporary, current);
}
function restart() { run("systemctl", ["--user", "restart", service]); }
const digest = value => createHash("sha256").update(value).digest("hex");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Check actual content, not just an HTTP 200 from an unrelated process.
async function health(url, directory, alive = () => true) {
  const project = join(directory, "xingbei-cli");
  const resources = [
    ["/web/app.js", "web/app.js"], ["/assets/stones/gem.png", "assets/image/card/xingShi/baoShi.png"],
    ["/font/suits.woff2", "assets/font/suits.woff2"],
  ].map(([path, file]) => [path, digest(readFileSync(join(project, file)))]);
  let lastError;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!alive()) throw new Error("Candidate server exited before becoming healthy");
    try {
      for (const [path, expected] of [["/", null], ...resources]) {
        const response = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(2000), cache: "no-store" });
        if (response.status !== 200) throw new Error(`${path}: HTTP ${response.status}`);
        const data = Buffer.from(await response.arrayBuffer());
        if (expected ? digest(data) !== expected : !data.toString().includes('id="players"')) throw new Error(`${path}: unexpected response content`);
      }
      return;
    } catch (error) { lastError = error; await sleep(250); }
  }
  throw lastError;
}
async function smoke(directory) {
  const listener = createServer();
  listener.listen(0, "127.0.0.1"); await once(listener, "listening");
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const child = spawn(process.execPath, [join(directory, "xingbei-cli/server.js")], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), TEST_MODE: "1" }, stdio: ["ignore", "ignore", "pipe"],
  });
  let errorText = "", spawnError;
  child.stderr.on("data", data => { errorText = (errorText + data).slice(-4000); });
  child.on("error", error => { spawnError = error; });
  try { await health(`http://127.0.0.1:${port}`, directory, () => !spawnError && child.exitCode === null); }
  catch (error) { throw new Error(`${error.message}\n${spawnError?.message || errorText}`); }
  finally {
    if (child.pid && child.exitCode === null) {
      const exited = once(child, "exit"); child.kill();
      const timeout = setTimeout(() => child.kill("SIGKILL"), 3000);
      await exited; clearTimeout(timeout);
    }
  }
}

async function update() {
  if (!config.repository) throw new Error("config.repository is required");
  run("git", ["check-ref-format", `refs/heads/${branch}`]);
  mkdirSync(releases, { recursive: true });
  if (!existsSync(repository)) run("git", ["init", "--bare", repository]);
  const git = params => run("git", ["--git-dir", repository, ...params], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=15" },
  });
  git(["fetch", "--no-tags", "--force", "--", config.repository, `refs/heads/${branch}:refs/deploy/target`]);
  const commit = git(["rev-parse", "refs/deploy/target^{commit}"]);
  const previous = target();
  if (metadata(previous)?.commit === commit) { console.log(`Already deployed: ${branch}@${commit.slice(0, 12)}`); return; }
  if (args.includes("--prepare") && previous) throw new Error("--prepare is only for the initial installation; use a normal update for an existing deployment");
  if (!args.includes("--retry") && existsSync(failed) && JSON.parse(readFileSync(failed, "utf8")).commit === commit) {
    console.log(`Skipping previously failed commit ${commit.slice(0, 12)}; use --retry after fixing the environment`); return;
  }
  let staging = mkdtempSync(join(releases, ".candidate-")), switched = false;
  const release = join(releases, commit);
  try {
    const archive = join(staging, "source.tar");
    git(["archive", "--format=tar", `--output=${archive}`, commit]);
    run("tar", ["-xf", archive, "-C", staging]); rmSync(archive);
    const project = join(staging, "xingbei-cli");
    if (config.artifactsDirectory && existsSync(config.artifactsDirectory)) {
      const destination = join(project, "artifacts");
      mkdirSync(destination, { recursive: true });
      // Keep versioned evidence from the release; mount only missing local evidence folders.
      for (const name of readdirSync(config.artifactsDirectory)) {
        if (!existsSync(join(destination, name))) symlinkSync(resolve(config.artifactsDirectory, name), join(destination, name));
      }
    }
    const packageInfo = JSON.parse(readFileSync(join(project, "package.json"), "utf8"));
    if (Object.keys(packageInfo.dependencies || {}).length || Object.keys(packageInfo.devDependencies || {}).length) {
      throw new Error("Deployment currently supports the zero-dependency project only; dependency installation must be configured explicitly");
    }
    console.log(`Validating ${branch}@${commit.slice(0, 12)} (v${packageInfo.version})`);
    run("npm", ["--prefix", project, "test"], { stdio: "inherit" });
    await smoke(staging);
    writeFileSync(join(staging, ".deployment.json"), JSON.stringify({ commit, branch, repository: config.repository, version: packageInfo.version, deployedAt: new Date().toISOString() }, null, 2) + "\n");
    if (existsSync(release)) rmSync(release, { recursive: true });
    renameSync(staging, release); staging = null;
    switchTo(release); switched = true;
    if (!args.includes("--prepare")) {
      restart(); await health(baseUrl, release);
      run("systemctl", ["--user", "is-active", "--quiet", service]);
      const workingDirectory = run("systemctl", ["--user", "show", service, "--property=WorkingDirectory", "--value"]);
      if (resolve(workingDirectory) !== join(current, "xingbei-cli")) throw new Error("Service is not configured to run from the deployment current directory");
    }
    rmSync(failed, { force: true });
    // Keep the current release, immediate rollback release and one other recent release.
    const retained = new Set([release, previous].filter(Boolean));
    const others = readdirSync(releases).filter(name => /^[a-f0-9]{40}$/.test(name)).map(name => join(releases, name))
      .filter(path => !retained.has(path)).sort((a, b) => metadata(b).deployedAt.localeCompare(metadata(a).deployedAt));
    for (const obsolete of others.slice(1)) rmSync(obsolete, { recursive: true });
    console.log(`${args.includes("--prepare") ? "Prepared" : "Deployed"}: ${branch}@${commit.slice(0, 12)} v${packageInfo.version}`);
  } catch (error) {
    if (switched) {
      if (previous) switchTo(previous); else rmSync(current, { force: true });
      if (!args.includes("--prepare") && previous) {
        try { restart(); await health(baseUrl, previous); console.error("Previous deployment restored"); }
        catch (rollbackError) { console.error(`ROLLBACK FAILED: ${rollbackError.message}`); }
      }
    }
    writeFileSync(failed, JSON.stringify({ commit, branch, time: new Date().toISOString(), error: error.message }, null, 2) + "\n");
    throw error;
  } finally { if (staging) rmSync(staging, { recursive: true, force: true }); }
}

try {
  if (args.includes("--status")) {
    console.log(JSON.stringify({ root, service, branch, healthUrl: baseUrl, current: metadata(target()), failed: existsSync(failed) ? JSON.parse(readFileSync(failed, "utf8")) : null }, null, 2));
  } else if (!args.includes("--locked")) {
    // The OS releases this lock even if deployment is interrupted or the machine reboots.
    const result = spawnSync("flock", ["--nonblock", "--conflict-exit-code", "75", join(root, "update.lock"), process.execPath, fileURLToPath(import.meta.url), ...args, "--locked"], { stdio: "inherit", env: process.env });
    if (result.status === 75) console.log("Another deployment is running; skipped");
    else if (result.error || result.status !== 0) process.exitCode = result.status || 1;
  } else await update();
} catch (error) { console.error(error.message); process.exitCode = 1; }
