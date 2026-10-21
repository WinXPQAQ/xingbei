import { driveGame } from './driver.mjs';
let randomState = 735923;
const random = () => ((randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const started = performance.now();
const results = [];
for (let i = 0; i < Number(process.argv[2] ?? 24); i++) {
  results.push(await driveGame({ seed: 210000000 + i, start: i % 6 }, ({ candidates }) => Math.floor(random() * candidates.length)));
}
console.log(JSON.stringify({ mode: 'uniform-legal-smoke-not-strength-evaluation', elapsedMs: performance.now() - started, results }, null, 2));
