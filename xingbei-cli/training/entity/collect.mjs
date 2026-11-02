import fs from 'node:fs';
import { driveGame } from '../driver.mjs';
import { teacherIndex } from '../teacher.mjs';
import { encodeDecision } from '../observation.mjs';
import { encodeEntities } from './observation.mjs';
import { DEFAULT_HERO_IDS, WAVE_TWO_HERO_IDS, WAVE_THREE_HERO_IDS } from '../../src/hero.js';

// Complete games are records: split seeds/games before fitting vocabulary or
// training. Never randomly split individual decisions from the same game.
const output = process.argv[2];
if (!output) throw new Error('Usage: node training/entity/collect.mjs OUTPUT.jsonl [GAMES=12] [SEED=211102100]');
const games = Number(process.argv[3] ?? 12), seed = Number(process.argv[4] ?? 211102100);
const file = fs.openSync(output, 'wx');
const teacher = 'v1.8.0-preview.1', rosters = [DEFAULT_HERO_IDS, WAVE_TWO_HERO_IDS, WAVE_THREE_HERO_IDS];
const totals = { games: 0, decisions: 0, candidates: 0, legacyMs: 0, entityMs: 0, teacherMs: 0, legacyBytes: 0, entityBytes: 0 };
const started = performance.now();
try {
  for (let index = 0; index < games; index++) {
    const decisions = [], heroIds = rosters[index % rosters.length];
    const result = await driveGame({ seed: seed + index, heroIds, start: index % 6 }, input => {
      let time = performance.now(); const legacy = encodeDecision(input); totals.legacyMs += performance.now() - time;
      time = performance.now(); const observation = encodeEntities(input); totals.entityMs += performance.now() - time;
      time = performance.now(); const choice = teacherIndex(input, teacher); totals.teacherMs += performance.now() - time;
      totals.legacyBytes += Buffer.byteLength(JSON.stringify(legacy)); totals.entityBytes += Buffer.byteLength(JSON.stringify(observation));
      totals.decisions++; totals.candidates += input.candidates.length;
      decisions.push({ seat: input.playerId, choice, observation }); return choice;
    });
    if (!result.terminated) throw new Error(`Truncated game ${result.seed}; not a loss label`);
    fs.writeSync(file, JSON.stringify({ schema: 'entities-v2', teacher, heroIds, result, decisions }) + '\n');
    totals.games++;
  }
} finally { fs.closeSync(file); }
console.log(JSON.stringify({ ...totals, elapsedMs: performance.now() - started, output }, null, 2));
