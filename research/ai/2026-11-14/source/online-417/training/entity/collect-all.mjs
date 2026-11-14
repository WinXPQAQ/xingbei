import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { driveGame } from '../driver.mjs';
import { teacherIndex } from '../teacher.mjs';
import { createEntityEncoder, ENTITY_SCHEMA } from './observation.mjs';
import { selectEntityDecision } from './decisions.mjs';
import { HERO_IDS, roster } from './rosters.mjs';
import { AI_POLICY_VERSION } from '../../src/ai.js';
import { createTeacherSampler, teacherSamplingConfig } from './teacher-sampling.mjs';

function summarize(record) {
  return { heroIds: record.heroIds, retained: record.decisions.length, sampling: record.sampling };
}

function createTotals(samplingConfig) {
  return {
    coverage: Object.fromEntries(HERO_IDS.map(id => [id, 0])),
    sampling: { config: samplingConfig, observed: 0, retained: 0, retainedBytes: 0,
      eligibleChains: 0, retainedChains: 0, omittedChains: 0, oversizedSamples: 0, byHero: {} },
  };
}

function recordCoverage({ coverage, sampling }, record) {
  for (const id of record.heroIds) coverage[id]++;
  sampling.observed += record.sampling.observed;
  sampling.retained += record.retained;
  sampling.retainedBytes += record.sampling.retainedBytes;
  for (const seat of record.sampling.coverage) {
    sampling.eligibleChains += seat.eligibleChains;
    sampling.retainedChains += Number(seat.retainedChain != null);
    sampling.omittedChains += seat.omittedChains;
    sampling.oversizedSamples += seat.oversizedSamples;
    const hero = record.heroIds[seat.seat];
    const entry = sampling.byHero[hero] ??= { observed: 0, retained: 0, strata: {} };
    entry.observed += seat.observed;
    entry.retained += seat.retained;
    for (const stratum of seat.strata) {
      const counts = entry.strata[stratum.key] ??= { observed: 0, retained: 0 };
      counts.observed += stratum.seen;
      counts.retained += stratum.retained;
    }
  }
}

function readRecord(file, index, { revision, samplingConfig }) {
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (record.schema !== ENTITY_SCHEMA || record.teacher !== AI_POLICY_VERSION ||
      record.result.revision !== revision || record.result.seed !== 731103000 + index ||
      record.result.start !== index % 6 || !record.result.terminated ||
      JSON.stringify(record.heroIds) !== JSON.stringify(roster(index))) {
    throw new Error(`Incompatible resumed corpus: ${file}`);
  }
  if (JSON.stringify(record.sampling?.config) !== JSON.stringify(samplingConfig)) {
    throw new Error(`Teacher sampling configuration changed: use a new corpus directory (${file})`);
  }
  return record;
}

async function collectGame(index, { directory, revision, samplingConfig }) {
  const seed = 731103000 + index;
  const heroIds = roster(index);
  const sampler = createTeacherSampler(seed, samplingConfig);
  const encodeEntities = createEntityEncoder();
  const result = await driveGame({ seed, heroIds, start: index % 6, capture: true, revision,
    decisionMode: 'hierarchical-v1' }, input => {
    const choice = teacherIndex(input, AI_POLICY_VERSION);
    return selectEntityDecision(input, (step, answer) => {
      const observation = encodeEntities(step);
      sampler.add(step, answer, observation, input.rootRequest ?? input.request);
      return answer;
    }, { teacher: choice });
  });
  if (!result.terminated) throw new Error(`Teacher game truncated: ${result.seed}`);
  const record = { schema: ENTITY_SCHEMA, teacher: AI_POLICY_VERSION, heroIds, result, ...sampler.finish() };
  const file = path.join(directory, 'games', `${index}.json`);
  fs.writeFileSync(file + '.tmp', JSON.stringify(record));
  fs.renameSync(file + '.tmp', file);
  return summarize(record);
}

async function collectPending(indices, settings, workerCount, onComplete) {
  if (!indices.length) return;
  const workers = [];
  let next = 0;
  let completed = 0;
  let settled = false;
  try {
    await new Promise((resolve, reject) => {
      const fail = error => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const dispatch = worker => {
        if (next < indices.length) worker.postMessage(indices[next++]);
      };
      for (let i = 0; i < Math.min(workerCount, indices.length); i++) {
        const worker = new Worker(new URL(import.meta.url), { workerData: settings });
        workers.push(worker);
        worker.on('error', fail);
        worker.on('exit', code => {
          if (!settled) fail(new Error(`Teacher worker exited unexpectedly (${code})`));
        });
        worker.on('message', message => {
          if (settled) return;
          if (message.error) {
            const error = new Error(message.error.message);
            error.stack = message.error.stack;
            fail(error);
            return;
          }
          try {
            onComplete(message.summary);
            completed++;
            if (completed === indices.length) {
              settled = true;
              resolve();
            } else {
              dispatch(worker);
            }
          } catch (error) {
            fail(error);
          }
        });
        dispatch(worker);
      }
    });
  } finally {
    // Wait for every worker to stop before propagating errors or exporting the corpus.
    settled = true;
    await Promise.allSettled(workers.map(worker => worker.terminate()));
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    options: { workers: { type: 'string', default: '16' } }, allowPositionals: true,
  });
  const [directory, rawCount = '2400'] = positionals;
  const count = Number(rawCount);
  const workerCount = Number(values.workers);
  if (!directory || positionals.length > 2 || !Number.isSafeInteger(count) || count < 1 ||
      !Number.isSafeInteger(workerCount) || workerCount < 1) {
    throw new Error('collect-all.mjs DIRECTORY [GAMES=2400] [--workers=16]');
  }
  fs.mkdirSync(path.join(directory, 'games'), { recursive: true });
  fs.mkdirSync(path.join(directory, 'rule-failures'), { recursive: true });
  const revision = process.env.XINGBEI_SOURCE_REVISION ?? 'development';
  const samplingConfig = teacherSamplingConfig();
  const settings = { directory, revision, samplingConfig };
  const progressTotals = createTotals(samplingConfig);
  let completed = 0;
  const writeProgress = () => {
    const { byHero, ...sampleTotals } = progressTotals.sampling;
    const progress = { completed, games: count,
      coverageMinimum: Math.min(...Object.values(progressTotals.coverage)), sampling: sampleTotals };
    const file = path.join(directory, 'collection-progress.json');
    fs.writeFileSync(file + '.tmp', JSON.stringify(progress));
    fs.renameSync(file + '.tmp', file);
    console.log(JSON.stringify(progress));
  };
  const pending = [];
  // Validate all resumed games before starting any new work.
  for (let index = 0; index < count; index++) {
    const file = path.join(directory, 'games', `${index}.json`);
    if (fs.existsSync(file)) {
      recordCoverage(progressTotals, summarize(readRecord(file, index, settings)));
      completed++;
    } else {
      pending.push(index);
    }
  }
  writeProgress();
  await collectPending(pending, settings, workerCount, summary => {
    recordCoverage(progressTotals, summary);
    completed++;
    if (completed % 12 === 0 || completed === count) writeProgress();
  });

  const totals = createTotals(samplingConfig);
  const data = fs.openSync(path.join(directory, 'teacher.jsonl.tmp'), 'w');
  const endings = fs.openSync(path.join(directory, 'positions.jsonl.tmp'), 'w');
  try {
    for (let index = 0; index < count; index++) {
      const record = readRecord(path.join(directory, 'games', `${index}.json`), index, settings);
      recordCoverage(totals, summarize(record));
      // Completion order never changes corpus ordering or whole-game train/validation splits.
      for (const boundary of record.result.boundaries) {
        fs.writeSync(endings, JSON.stringify({ ...boundary, sourceSeed: record.result.seed }) + '\n');
      }
      delete record.result.boundaries;
      fs.writeSync(data, JSON.stringify(record) + '\n');
    }
  } finally {
    fs.closeSync(data);
    fs.closeSync(endings);
  }
  for (const file of ['teacher.jsonl', 'positions.jsonl']) {
    fs.renameSync(path.join(directory, file + '.tmp'), path.join(directory, file));
  }
  fs.writeFileSync(path.join(directory, 'coverage.json'), JSON.stringify({ revision, games: count, ...totals }, null, 2));
}

if (isMainThread) {
  await main();
} else {
  process.env.XINGBEI_DIAGNOSTIC_DIR = path.join(workerData.directory, 'rule-failures');
  parentPort.on('message', async index => {
    try {
      parentPort.postMessage({ summary: await collectGame(index, workerData) });
    } catch (error) {
      parentPort.postMessage({ error: { message: error.message, stack: error.stack } });
    }
  });
}
