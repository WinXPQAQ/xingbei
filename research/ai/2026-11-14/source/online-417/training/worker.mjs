import { createInterface } from 'node:readline';
import { driveGame } from './driver.mjs';
import { encodeDecision } from './observation.mjs';
import { createEntityEncoder, ENTITY_SCHEMA } from './entity/observation.mjs';
import { encodeTensorWire } from './entity/binary-wire.mjs';
import { createWireEncoder } from './entity/wire.mjs';
import { enrichPreview } from './preview.mjs';
import { selectEntityDecision } from './entity/decisions.mjs';
import { teacherIndex } from './teacher.mjs';

// JSON control headers may be followed by a length-delimited numeric payload.
// Each worker runs one game at a time; launch
// several workers and batch their pending decisions in the Python learner.
let running = false, waiting = null, sequence = 0;
const send = (value, body = null) => {
  process.stdout.write(JSON.stringify(value) + '\n');
  if (body) process.stdout.write(body);
};
createInterface({ input: process.stdin }).on('line', async line => {
  try {
    const message = JSON.parse(line);
    if (message.type === 'select') {
      if (!waiting || waiting.id !== message.id) throw new Error('Stale or unsolicited selection');
      const pending = waiting; waiting = null;
      pending.resolve(message.index);
      return;
    }
    if (message.type !== 'start' || running) throw new Error('Expected start while idle');
    if (message.schema && ![2, ENTITY_SCHEMA].includes(message.schema)) throw new Error('Unsupported observation schema');
    if (message.schema === ENTITY_SCHEMA && (message.baseline || message.seatBaselines)) throw new Error('Legacy residual baseline is incompatible with entity schema');
    if (message.schema === ENTITY_SCHEMA && message.teacher) throw new Error('Hierarchical teacher labels require a teacher-executed path; use collect-all or teacher seat policies');
    if (message.wire && (!['sparse-v1', 'sparse-delta-v1', 'tensor-v1'].includes(message.wire) || message.schema !== ENTITY_SCHEMA)) throw new Error('Unsupported wire format');
    const encoders = Object.fromEntries(Object.entries(message.vocabularies ?? {current:message.vocabulary}).map(([key,vocabulary]) => [key,message.wire ? createWireEncoder(vocabulary, { delta: message.wire === 'sparse-delta-v1' }) : value=>value]));
    const encodeEntities = createEntityEncoder();
    const forcedChoices = {};
    const requestIds = new WeakMap();
    let nextRequestId = 0;
    running = true;
    try {
      const result = await driveGame({ ...message.config, decisionMode: message.schema === ENTITY_SCHEMA ? "hierarchical-v1" : "flat" }, async input => {
        const policy = message.seatPolicies?.[input.playerId] ?? 'model';
        if (policy !== 'model' && !policy.startsWith('model:')) return teacherIndex(input, policy);
        // Keep driveGame.pick in the path so forced choices remain replayable.
        // No observation, GPU request or policy-gradient sample is necessary.
        if (message.schema === ENTITY_SCHEMA && input.candidates.length === 1) {
          const kind = [input.request.type, input.request.stage ?? 'complete'].join('/');
          forcedChoices[kind] = (forcedChoices[kind] ?? 0) + 1;
          return 0;
        }
        const modelKey = policy === 'model' ? 'current' : policy.slice(6);
        const pack = encoders[modelKey];
        if (!pack) throw new Error('Unknown network route');
        const fullTeacher = message.teacher ? teacherIndex(input, message.teacher) : null;
        const query = (input, teacher) => {
          const observation = message.schema === ENTITY_SCHEMA ? encodeEntities(input) : encodeDecision(input);
          const baselineVersion = message.seatBaselines?.[input.playerId] ?? message.baseline;
          if (baselineVersion && !['v1.5','experimental/hero-foundation-1'].includes(baselineVersion)) throw new Error('Unsupported baseline');
          const baseline = baselineVersion ? teacherIndex(input, baselineVersion) : null;
          if (baselineVersion) enrichPreview(observation);
          const id = ++sequence;
          return new Promise(resolve => {
            waiting = { id, resolve };
            const packed = pack(observation);
            const scope = input.decisionScope ?? input.request;
            if (!requestIds.has(scope)) requestIds.set(scope, ++nextRequestId);
            const team = input.game.player(input.playerId).team;
            const otherTeam = team === 'red' ? 'blue' : 'red';
            const header = { type: 'decision', id, seat: input.playerId, modelKey, teacher, baseline,
              learning: { requestId: requestIds.get(scope),
                ownMorale: input.game.teams[team].morale,
                enemyMorale: input.game.teams[otherTeam].morale } };
            if (message.wire === 'tensor-v1') {
              const frame = encodeTensorWire(packed);
              send({ ...header, observation: frame.observation, binaryBytes: frame.body.length }, frame.body);
            } else send({ ...header, observation: packed });
          });
        };
        return message.schema === ENTITY_SCHEMA ? selectEntityDecision(input, query, { teacher: fullTeacher }) : query(input, fullTeacher);
      });
      send({ type: 'result', result: { ...result, forcedChoices } });
    } finally { running = false; }
  } catch (error) {
    send({ type: 'error', error: error.stack });
    process.exitCode = 1;
    process.stdin.destroy();
  }
});
