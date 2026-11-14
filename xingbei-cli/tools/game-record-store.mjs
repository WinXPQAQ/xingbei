import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { controlledSeats } from '../src/play-mode.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Commit complete files atomically. A lost response can safely retry the same sequence.
async function saveJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  try {
    await rename(temporary, file);
    const directory = await open(dirname(file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
  finally { await rm(temporary, { force: true }); }
}

export function createGameRecordStore(directory, identity) {
  const pending = new Map();
  return async function handleRecords(request, response, pathname) {
    if (!pathname.startsWith('/api/game-records')) return false;
    if (!directory) fail(404, '对局记录未启用');
    if (request.method !== 'POST') fail(405, '只接受记录写入');
    const match = /^\/api\/game-records\/([a-f0-9]{48})(?:\/(\d{1,8}))?$/.exec(pathname);
    if (!match) fail(404, '记录地址无效');
    const [, id, sequenceText] = match;
    const token = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
    if (!/^[a-f0-9]{48}$/.test(token)) fail(401, '记录凭据无效');
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) fail(413, '记录过大');
      chunks.push(chunk);
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { fail(400, '记录格式无效'); }
    const previous = pending.get(id) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      const folder = join(directory, id);
      const metadataFile = join(folder, 'metadata.json');
      const metadata = await readJson(metadataFile);
      const tokenHash = digest(token);
      if (metadata && metadata.tokenHash !== tokenHash) fail(403, '记录凭据不匹配');
      if (sequenceText === undefined) {
        const { mode, humanSeat, aiSeats, initialConfig } = body ?? {};
        const teams = initialConfig?.teams ?? ['red', 'blue', 'blue', 'red', 'red', 'blue'];
        const validTeams = Array.isArray(teams) && teams.length === 6 && teams.filter(t => t === 'red').length === 3 && teams.filter(t => t === 'blue').length === 3;
        const humanSeats = body?.humanSeats ?? (mode === 'normal' ? [humanSeat] : []);
        const expected = validTeams && Number.isInteger(humanSeat) && humanSeat >= 0 && humanSeat < 6 ? controlledSeats(mode, humanSeat, teams) : [];
        if (!['normal', 'team'].includes(mode) || !Number.isInteger(humanSeat) || humanSeat < 0 || humanSeat > 5 || !validTeams ||
            !Array.isArray(humanSeats) || humanSeats.length !== expected.length || new Set(humanSeats).size !== humanSeats.length || humanSeats.some(id => !expected.includes(id)) ||
            (mode === 'team' && body.informationScope !== 'team-memory') ||
            !Array.isArray(aiSeats) || aiSeats.length !== 6 - expected.length ||
            new Set([...humanSeats, ...aiSeats]).size !== 6 ||
            aiSeats.some(seat => !Number.isInteger(seat) || seat < 0 || seat > 5) ||
            !Number.isSafeInteger(initialConfig?.seed) || initialConfig?.heroIds?.length !== 6 ||
            body.modelHash !== identity.model?.checkpointSha256 || body.ruleRevision !== identity.ruleRevision) {
          fail(400, '仅记录当前规则与模型的正常或同阵营多控对局');
        }
        const requestHash = digest(JSON.stringify(body));
        if (metadata && metadata.requestHash !== requestHash) fail(409, '对局已创建且内容不同');
        if (!metadata) {
          await mkdir(folder, { recursive: true, mode: 0o700 });
          await saveJson(metadataFile, { format: 'xingbei-human-game-v1', id, tokenHash, requestHash,
            createdAt: new Date().toISOString(), ...identity, configuration: body });
        }
        return { id };
      }
      if (!metadata) fail(404, '对局尚未创建');
      const sequence = Number(sequenceText);
      if (!body || typeof body.type !== 'string') fail(400, '缺少记录类型');
      const filename = join(folder, `${String(sequence).padStart(8, '0')}.json`);
      const existing = await readJson(filename);
      if (existing) {
        if (JSON.stringify(existing.event) !== JSON.stringify(body)) fail(409, '序号已使用且内容不同');
      } else {
        const entries = (await readdir(folder)).filter(name => /^\d{8}\.json$/.test(name)).sort();
        if (sequence !== entries.length) fail(409, '记录序号不连续');
        const last = entries.length ? await readJson(join(folder, entries.at(-1))) : null;
        if (last?.event.type === 'finished') fail(409, '已结束的对局不能继续写入');
        if (body.type === 'finished' && (!['red', 'blue'].includes(body.winner) || body.state?.winner !== body.winner)) {
          fail(400, '缺少有效终局结果');
        }
        await saveJson(filename, { sequence, receivedAt: new Date().toISOString(), event: body });
      }
      // Rebuilt on retries too, including recovery after a process restart.
      const summary = await readJson(join(folder, 'summary.json'));
      if (!summary || sequence >= summary.lastSequence) {
        await saveJson(join(folder, 'summary.json'), { id, lastSequence: sequence,
          status: body.type === 'finished' ? 'completed' : 'incomplete',
          winner: body.type === 'finished' ? body.winner : null, updatedAt: new Date().toISOString() });
      }
      return { id, sequence, saved: true };
    });
    pending.set(id, task);
    try {
      const result = await task;
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(result));
      return true;
    } finally { if (pending.get(id) === task) pending.delete(id); }
  };
}
