import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameRecordStore } from '../tools/game-record-store.mjs';

test('正常人机局记录排除其他模式，重试与服务恢复保持序号和终局结果', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xingbei-record-test-'));
  const modelHash = 'c'.repeat(64), id = 'a'.repeat(48), token = 'b'.repeat(48);
  const identity = { model: { checkpointSha256: modelHash }, ruleRevision: 'fixture' };
  let handler = createGameRecordStore(directory, identity);
  const server = createServer(async (req, res) => {
    try { await handler(req, res, new URL(req.url, 'http://localhost').pathname); }
    catch (error) { res.writeHead(error.status ?? 500); res.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const post = (suffix, body, credential = token, recordId = id) => fetch(`http://127.0.0.1:${server.address().port}/api/game-records/${recordId}${suffix}`, {
    method: 'POST', headers: { Authorization: `Bearer ${credential}` }, body: JSON.stringify(body),
  });
  try {
    const config = { mode: 'normal', humanSeat: 0, aiSeats: [1, 2, 3, 4, 5], modelHash, ruleRevision: 'fixture',
      initialConfig: { seed: 123, heroIds: ['a', 'b', 'c', 'd', 'e', 'f'] } };
    for (const mode of ['test', 'spectate', 'developer']) assert.equal((await post('', { ...config, mode })).status, 400);
    assert.equal((await post('', { ...config, aiSeats: [1, 2, 3, 4, 4] })).status, 400);
    assert.equal((await post('', { ...config, ruleRevision: 'old-client' })).status, 400);
    assert.equal((await post('', config)).status, 200);
    assert.equal((await post('', config)).status, 200);
    const event = { type: 'command', name: 'beginTurn', args: [0] };
    assert.equal((await post('/1', event)).status, 409);
    const duplicates = await Promise.all([post('/0', event), post('/0', event)]);
    assert.deepEqual(duplicates.map(r => r.status), [200, 200]);
    assert.equal((await post('/0', { ...event, args: [1] })).status, 409);
    assert.equal((await post('/1', event, 'd'.repeat(48))).status, 403);
    handler = createGameRecordStore(directory, identity);
    assert.equal((await post('/0', event)).status, 200);
    assert.equal((await post('/1', { type: 'finished', winner: 'red', state: { winner: null } })).status, 400);
    const finish = { type: 'finished', winner: 'red', state: { winner: 'red' } };
    assert.equal((await post('/1', finish)).status, 200);
    assert.equal((await post('/1', finish)).status, 200);
    assert.equal((await post('/2', event)).status, 409);
    // Retrying an earlier event must not revert the completed status.
    assert.equal((await post('/0', event)).status, 200);
    const summary = JSON.parse(await readFile(join(directory, id, 'summary.json')));
    assert.equal(summary.status, 'completed'); assert.equal(summary.winner, 'red');
    assert.equal(summary.lastSequence, 1);
    const teamId = 'e'.repeat(48);
    const team = {...config, mode:'team', humanSeat:1, humanSeats:[1,2,5], aiSeats:[0,3,4], informationScope:'team-memory'};
    assert.equal((await post('', {...team,humanSeats:[0,1,2]},token,teamId)).status,400);
    assert.equal((await post('', {...team,informationScope:'individual'},token,teamId)).status,400);
    assert.equal((await post('', team,token,teamId)).status,200);
    assert.equal((await post('/0', {type:'perspective-change',playerId:5},token,teamId)).status,200);
    assert.equal((await post('/1', finish,token,teamId)).status,200);
    const metadata = JSON.parse(await readFile(join(directory,teamId,'metadata.json')));
    assert.deepEqual(metadata.configuration.humanSeats,[1,2,5]);
    assert.equal(metadata.configuration.informationScope,'team-memory');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
