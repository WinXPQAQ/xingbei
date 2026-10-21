import { actionCandidates, decisionCandidates, decisionPlayer } from '/training/candidates.mjs';
import { encodeDecision } from '/training/observation.mjs';
import { enrichPreview } from '/training/preview.mjs';
import { teacherIndex } from '/training/teacher.mjs';

export const modelEnabled = window.XINGBEI_MODEL === true;
const clients = new WeakMap();
export function installModel(game, isHuman, session, gate) {
  if (!modelEnabled) return;
  const id = [...crypto.getRandomValues(new Uint8Array(24))].map(n => n.toString(16).padStart(2, '0')).join('');
  clients.set(game, { id, sequence: 0, session, gate });
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
  await client.gate();
  client.session.assert();
  const candidates = request.type === 'action' ? actionCandidates(game, playerId) : decisionCandidates(game, request);
  const input = { game, playerId, request, candidates };
  const baseline = teacherIndex(input, 'v1.5');
  const observation = encodeDecision(input);
  enrichPreview(observation);
  const sequence = client.sequence;
  const response = await fetch('/api/model/choose', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: client.id, sequence, seat: playerId, baseline, observation }), signal: AbortSignal.timeout(30000) });
  client.session.assert();
  const result = await response.json();
  if (!response.ok || result.sequence !== sequence || !Number.isInteger(result.choice) || result.choice < 0 || result.choice >= candidates.length) {
    throw new Error(`模型推理失败，请重新开始：${result.error || '无效返回'}`);
  }
  client.sequence++;
  return candidates[result.choice];
}
