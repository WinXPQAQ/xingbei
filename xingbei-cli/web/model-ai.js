import { actionCandidates, decisionCandidates, decisionPlayer } from '/training/candidates.mjs';
import { encodeDecision } from '/training/observation.mjs';
import { enrichPreview } from '/training/preview.mjs';
import { teacherIndex } from '/training/teacher.mjs';
import { resolveDecision } from '/training/decision-runner.mjs';
import { createEntityEncoder, ENTITY_SCHEMA } from '/training/entity/observation.mjs';

export const modelEnabled = window.XINGBEI_MODEL === true;
const clients = new WeakMap();
const sessionId = () => [...crypto.getRandomValues(new Uint8Array(24))].map(n => n.toString(16).padStart(2, '0')).join('');

function connectionStatus(client, message) {
  if (client.session.cancelled) return;
  let status = document.querySelector('#model-connection-status');
  if (!status) {
    status = document.createElement('span'); status.id = 'model-connection-status';
    status.setAttribute('role', 'status');
    (document.querySelector('#test-version') || document.querySelector('#window')).append(status);
  }
  status.textContent = message;
  status.hidden = !message;
}

async function waitForConnection(client) {
  while (document.hidden || !navigator.onLine) {
    connectionStatus(client, document.hidden ? '切回页面后继续' : '连接中断，等待网络恢复…');
    await client.session.wait(resolve => {
      const ready = () => { if (!document.hidden && navigator.onLine) resolve(); };
      document.addEventListener('visibilitychange', ready);
      window.addEventListener('online', ready);
      window.addEventListener('pageshow', ready);
      ready();
      return () => {
        document.removeEventListener('visibilitychange', ready);
        window.removeEventListener('online', ready);
        window.removeEventListener('pageshow', ready);
      };
    });
  }
  client.session.assert();
}

export function installModel(game, isHuman, session, gate) {
  if (!modelEnabled) return;
  const id = sessionId();
  const identity = window.XINGBEI_MODEL_IDENTITY;
  if (!identity || (identity.architecture === 'entity' && identity.schema !== ENTITY_SCHEMA)) {
    throw new Error('模型接口身份不兼容，请刷新页面');
  }
  clients.set(game, { id, sequence: 0, session, gate, identity, encode: createEntityEncoder() });
  connectionStatus(clients.get(game), '');
  const original = game.interactiveDecision.bind(game);
  game.interactiveDecision = async (request, options) => {
    const playerId = decisionPlayer(request);
    if (isHuman(playerId)) return original(request, options);
    const result = await modelChoice(game, playerId, request);
    if (request.type === 'overflow') return game.resolveOverflowWithDecisions(playerId, result, options);
    return result;
  };
}
export async function modelChoice(game, playerId, request = { type: 'action' }) {
  const client = clients.get(game);
  await waitForConnection(client);
  connectionStatus(client, '');
  await client.gate();
  client.session.assert();
  if (client.identity.architecture === 'entity') {
    return resolveDecision(game, playerId, request, async input => {
      await client.gate();
      client.session.assert();
      const observation = client.encode(input);
      const choice = input.candidates.length === 1 ? 0 : await requestChoice(client, playerId, { observation }, input.candidates.length);
      await game.onModelDecision?.({ playerId, request: input.request, candidates: input.candidates, observation, choice });
      return choice;
    });
  }
  const candidates = request.type === 'action' ? actionCandidates(game, playerId) : decisionCandidates(game, request);
  const input = { game, playerId, request, candidates };
  const baselineVersion = window.XINGBEI_MODEL_BASELINE;
  if (!['v1.5', 'experimental/hero-foundation-1'].includes(baselineVersion)) throw new Error('模型基础策略身份缺失');
  const baseline = teacherIndex(input, baselineVersion);
  const observation = encodeDecision(input);
  enrichPreview(observation);
  const choice = await requestChoice(client, playerId, { baselineVersion, baseline, observation }, candidates.length);
  await game.onModelDecision?.({ playerId, request, candidates, observation, choice });
  return candidates[choice];
}

async function requestChoice(client, playerId, payload, candidateCount) {
  let attempt = 0;
  while (true) {
    await waitForConnection(client);
    const sequence = client.sequence;
    // Retries keep the same session, sequence and payload so an accepted response is reusable.
    const body = JSON.stringify({ session: client.id, sequence, seat: playerId, ...payload });
    const completed = await client.session.wait(resolve => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const disconnected = () => { if (document.hidden || !navigator.onLine) controller.abort(); };
      document.addEventListener('visibilitychange', disconnected);
      window.addEventListener('offline', disconnected);
      fetch('/api/model/choose', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body, signal: controller.signal })
        .then(async response => ({ ok: response.ok, status: response.status, result: await response.json().catch(() => null) }))
        .then(value => resolve({ value }), error => resolve({ error }));
      return () => {
        clearTimeout(timeout); controller.abort();
        document.removeEventListener('visibilitychange', disconnected);
        window.removeEventListener('offline', disconnected);
      };
    });
    client.session.assert();
    if (completed.error || completed.value.status >= 500 || [408, 429].includes(completed.value.status)) {
      connectionStatus(client, '连接中断，正在重连…');
      await client.session.delay(Math.min(5000, 1000 * 2 ** Math.min(attempt++, 3)));
      continue;
    }
    const { ok, result } = completed.value;
    if (!ok && sequence > 0 && client.identity.architecture === 'entity' && result?.error === 'Stale decision or expired session; restart the game') {
      // Entity inference is stateless; the full observation and seat history remain in this client.
      client.id = sessionId(); client.sequence = 0;
      connectionStatus(client, '正在恢复对局连接…');
      continue;
    }
    if (!ok || !result || result.sequence !== sequence || !Number.isInteger(result.choice) || result.choice < 0 || result.choice >= candidateCount) {
      throw new Error(`模型推理失败，请重新开始：${result?.error || '无效返回'}`);
    }
    if (result.checkpointSha256 !== client.identity.checkpointSha256 ||
        (client.identity.architecture === 'entity' && result.schema !== ENTITY_SCHEMA)) {
      throw new Error('推理模型已变更，请刷新页面并重新开始');
    }
    client.sequence++;
    connectionStatus(client, '');
    return result.choice;
  }
}
