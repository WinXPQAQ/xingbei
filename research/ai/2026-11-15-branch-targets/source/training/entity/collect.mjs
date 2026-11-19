import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { driveGame } from '../driver.mjs';
import { teacherIndex } from '../teacher.mjs';
import { selectEntityDecision } from './decisions.mjs';
import { createEntityEncoder, ENTITY_SCHEMA } from './observation.mjs';
import { roster } from './rosters.mjs';
import { AI_POLICY_VERSION } from '../../src/ai.js';
import { createTeacherSampler, teacherSamplingConfig } from './teacher-sampling.mjs';

// Complete games are records: split seeds/games before fitting vocabulary or
// training. Never randomly split individual decisions from the same game.
const output = process.argv[2];
if (!output) throw new Error('Usage: node training/entity/collect.mjs OUTPUT.jsonl [GAMES=12] [SEED=211102100]');
const games = Number(process.argv[3] ?? 12), seed = Number(process.argv[4] ?? 211102100);
if (!Number.isSafeInteger(games) || games < 1 || !Number.isSafeInteger(seed)) throw new Error('GAMES and SEED must be integers; GAMES must be positive');
const revision = process.env.XINGBEI_SOURCE_REVISION ? { commit: process.env.XINGBEI_SOURCE_REVISION, immutableSnapshot: true } : { commit: execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(),
  diffSha256: createHash('sha256').update(execFileSync('git', ['diff', 'HEAD', '--', 'src', 'training'])).digest('hex') };
const file = fs.openSync(output, 'wx');
const teacher = AI_POLICY_VERSION, samplingConfig = teacherSamplingConfig();
const totals = { games: 0, decisions: 0, retainedDecisions: 0, candidates: 0, entityMs: 0, teacherMs: 0, entityBytes: 0 };
const started = performance.now();
try {
  for (let index = 0; index < games; index++) {
    const heroIds = roster(index), sampler = createTeacherSampler(seed + index, samplingConfig);
    const encodeEntities = createEntityEncoder();
    const result = await driveGame({ seed: seed + index, heroIds, start: index % 6, revision, decisionMode: 'hierarchical-v1' }, input => {
      let time = performance.now();
      const choice = teacherIndex(input, teacher); totals.teacherMs += performance.now() - time;
      return selectEntityDecision(input, (step, answer) => {
        time = performance.now(); const observation = encodeEntities(step); totals.entityMs += performance.now() - time;
        totals.entityBytes += Buffer.byteLength(JSON.stringify(observation));
        totals.decisions++; totals.candidates += step.candidates.length;
        sampler.add(step, answer, observation, input.rootRequest ?? input.request); return answer;
      }, { teacher: choice });
    });
    if (!result.terminated) throw new Error(`Truncated game ${result.seed}; not a loss label`);
    const sampled = sampler.finish();
    fs.writeSync(file, JSON.stringify({ schema: ENTITY_SCHEMA, revision, teacher, heroIds, result, ...sampled }) + '\n');
    totals.retainedDecisions += sampled.decisions.length;
    totals.games++;
  }
} finally { fs.closeSync(file); }
console.log(JSON.stringify({ ...totals, elapsedMs: performance.now() - started, output }, null, 2));
