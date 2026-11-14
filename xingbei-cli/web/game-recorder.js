import { Cancelled } from './session.js';
import { decisionPlayer } from '../training/candidates.mjs';

const randomId = () => [...crypto.getRandomValues(new Uint8Array(24))].map(n => n.toString(16).padStart(2, '0')).join('');

function detached(value, game) {
  const stack = new Set();
  function copy(item) {
    if (typeof item === 'function' || item === game) return undefined;
    if (item == null || typeof item !== 'object') return item;
    if (stack.has(item)) return '[Circular]';
    stack.add(item);
    const source = item.toJSON?.() ?? item;
    const result = source instanceof Set ? [...source].map(copy)
      : source instanceof Map ? Object.fromEntries([...source].map(([key, val]) => [key, copy(val)]))
      : Array.isArray(source) ? source.map(copy)
      : Object.fromEntries(Object.entries(source).filter(([, val]) => typeof val !== 'function' && val !== game).map(([key, val]) => [key, copy(val)]));
    stack.delete(item);
    return result;
  }
  return copy(value);
}

export async function installGameRecorder(game, { mode, humanSeat, humanSeats = [humanSeat], session, developerScene = false }) {
  const flag = document.querySelector('#game-record-status');
  const status = text => { if (!session.cancelled && flag) flag.textContent = text; };
  if (!window.XINGBEI_RECORDING) return null;
  if (!['normal', 'team'].includes(mode) || developerScene) { status('本模式不记录'); return null; }
  const id = randomId(), token = randomId();
  const base = `/api/game-records/${id}`;
  let sequence = 0, queue = Promise.resolve(), ended = false;
  const outbox = await openRecordOutbox();
  let logOffset = 0, auditOffset = 0, historyOffset = 0, decisionNumber = 0, commandDepth = 0;
  const decisionStack = [];

  function state() {
    return detached({ current: game.current, winner: game.winner, teams: game.teams,
      players: game.players.map(player => player.toJSON()), cards: [...game.cards.values()],
      deck: game.deck.map(card => card.id), discard: game.discard.map(card => card.id),
      field: game.field.map(card => card.id), outside: game.outside.map(card => card.id),
      turn: game.turn.state, extraTurns: game.turn.extraTurns, followupTurns: game.turn.followupTurns,
      resumePlayerId: game.turn.resumePlayerId, publicHistory: game.publicHistory,
    }, game);
  }
  async function send(path, data, authorization = token) {
    const body = JSON.stringify(data);
    while (true) {
      session.assert();
      status('记录保存中');
      const result = await session.wait(resolve => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authorization}` }, body, signal: controller.signal })
          .then(async response => resolve({ ok: response.ok, status: response.status, text: await response.text() }))
          .catch(error => resolve({ error }));
        return () => { clearTimeout(timeout); controller.abort(); };
      });
      if (result.ok) { status(`记录已保存 · ${id.slice(0, 6)}`); return; }
      if (result.status >= 400 && result.status < 500) {
        status('记录异常 · 请重新开始');
        throw new Error(`对局记录失败（${result.status}），请重新开始`);
      }
      status('记录重试中');
      await session.delay(2000);
    }
  }
  function append(event) {
    const data = detached({ ...event, at: new Date().toISOString(),
      log: game.log.slice(logOffset), audit: game.auditTrail.slice(auditOffset),
      publicActions: game.publicHistory.actions.filter(event => event.sequence > historyOffset),
    }, game);
    logOffset = game.log.length; auditOffset = game.auditTrail.length;
    historyOffset = game.publicHistory.actionSequence;
    const index = sequence++;
    const path = `${base}/${index}`;
    const durable = outbox.put({path, data, token, createdAt:Date.now(), sequence:index});
    durable.catch(() => {});
    queue = queue.then(async () => {
      await durable;
      await send(path, data);
      await outbox.remove(path);
    });
    // Synchronous operations enqueue too; their failures are observed by the next await.
    queue.catch(error => { if (!(error instanceof Cancelled)) status('记录保存异常 · 本地待重传'); });
    return queue;
  }
  for (const entry of await outbox.pending()) {
    queue = queue.then(async () => {
      await send(entry.path, entry.data, entry.token);
      await outbox.remove(entry.path);
    });
  }
  await queue;
  const informationScope = mode === 'team' ? 'team-memory' : 'individual';
  await send(base, { mode, humanSeat, humanSeats, informationScope, aiSeats: game.players.filter(p => !humanSeats.includes(p.id)).map(p => p.id),
    initialConfig: game.initialConfig, modelHash: window.XINGBEI_MODEL_IDENTITY?.checkpointSha256,
    ruleRevision: window.XINGBEI_RULE_REVISION });
  await append({ type: 'initial', state: state() });

  async function recordDecision(request, operation) {
    if (decisionStack.at(-1)?.request === request) return operation();
    const decisionId = decisionNumber++;
    const parentDecisionId = decisionStack.at(-1)?.id ?? null;
    decisionStack.push({ id: decisionId, request });
    try {
      const actingSeat = decisionPlayer(request);
      append({ type: 'decision-request', decisionId, parentDecisionId, actingSeat, controller: humanSeats.includes(actingSeat) ? 'human' : 'ai', request, state: state() });
      const choice = await operation();
      append({ type: 'decision-choice', decisionId, choice });
      return choice;
    } finally { decisionStack.pop(); }
  }
  for (const name of ['interactiveDecision', 'onDecision']) {
    const original = game[name].bind(game);
    game[name] = (request, ...args) => recordDecision(request, () => original(request, ...args));
  }
  for (const name of ['executeAction', 'activateAsync', 'playWithDecisions', 'attackWithDecisions', 'playMagicWithDecisions', 'resolveOverflowWithDecisions', 'beginTurn', 'endTurnWithDecisions']) {
    const original = game[name].bind(game);
    game[name] = async (...args) => {
      // Nested overflow carries the actual indices, so retain it as its own command.
      const record = commandDepth === 0 || name === 'resolveOverflowWithDecisions';
      commandDepth++;
      try {
        if (record) append({ type: 'command', name, args, depth: commandDepth - 1, state: state() });
        if (name === 'beginTurn' && args[1]?.chooseWeakness) {
          const decide = args[1].chooseWeakness;
          args[1] = { ...args[1], chooseWeakness: request => recordDecision(request, () => decide(request)) };
        }
        const result = await original(...args);
        if (record) append({ type: 'command-result', name, state: state() });
        return result;
      } catch (error) {
        if (!(error instanceof Cancelled) && record) append({ type: 'command-error', name, message: error.message, state: state() });
        throw error;
      } finally { commandDepth--; }
    };
  }
  const skip = game.skipExtraActions.bind(game);
  game.skipExtraActions = playerId => {
    const before = state();
    const result = skip(playerId);
    append({ type: 'command', name: 'skipExtraActions', args: [playerId], state: before });
    return result;
  };
  game.onModelDecision = input => { append({ type: 'model-choice', ...input }); };
  return {
    id,
    viewed(playerId, handCardIds) { append({ type: 'perspective-change', playerId, handCardIds, informationScope }); },
    sorted(playerId) { append({ type: 'hand-order', playerId, cardIds: game.player(playerId).hand.map(card => card.id) }); },
    async finish() {
      if (ended) return;
      await append({ type: 'finished', winner: game.winner, state: state() });
      ended = true;
      status(`整局已保存 · ${id.slice(0, 6)}`);
    },
  };
}

// Ordered network uploads run independently of decisions. IndexedDB retains
// immutable pending records across page reloads until the server acknowledges.
function openRecordOutbox() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('xingbei-game-records', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pending', {keyPath:'path'});
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transact = (mode, operation) => new Promise((done, fail) => {
        const transaction = db.transaction('pending', mode);
        const result = operation(transaction.objectStore('pending'));
        transaction.oncomplete = () => done(result.result);
        transaction.onerror = () => fail(transaction.error);
        transaction.onabort = () => fail(transaction.error ?? new Error('记录缓存事务中断'));
      });
      resolve({
        put: entry => transact('readwrite', store => store.put(entry)),
        remove: path => transact('readwrite', store => store.delete(path)),
        pending: async () => (await transact('readonly', store => store.getAll()))
          .sort((a,b) => a.createdAt - b.createdAt || a.sequence - b.sequence),
      });
    };
  });
}
