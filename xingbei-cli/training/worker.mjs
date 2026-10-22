import { createInterface } from 'node:readline';
import { driveGame } from './driver.mjs';
import { encodeDecision } from './observation.mjs';
import { enrichPreview } from './preview.mjs';
import { teacherIndex } from './teacher.mjs';

// Persistent JSON-lines transport. Each worker runs one game at a time; launch
// several workers and batch their pending decisions in the Python learner.
let running = false, waiting = null, sequence = 0;
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
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
    running = true;
    try {
      const result = await driveGame(message.config, input => {
        const policy = message.seatPolicies?.[input.playerId] ?? 'model';
        if (policy !== 'model') return teacherIndex(input, policy);
        const observation = encodeDecision(input);
        const baselineVersion = message.seatBaselines?.[input.playerId] ?? message.baseline;
        if (baselineVersion && !['v1.5','experimental/hero-foundation-1'].includes(baselineVersion)) throw new Error('Unsupported baseline');
        const baseline = baselineVersion ? teacherIndex(input, baselineVersion) : null;
        if (baselineVersion) enrichPreview(observation);
        const teacher = message.teacher ? teacherIndex(input, message.teacher) : null;
        const id = ++sequence;
        return new Promise(resolve => {
          waiting = { id, resolve };
          send({ type: 'decision', id, seat: input.playerId, observation, teacher, baseline });
        });
      });
      send({ type: 'result', result });
    } finally { running = false; }
  } catch (error) {
    send({ type: 'error', error: error.stack });
    process.exitCode = 1;
    process.stdin.destroy();
  }
});
