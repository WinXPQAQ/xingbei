import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import assert from 'node:assert/strict';
import { playMatch } from './ai/evaluate.mjs';
const [input,output,seedCountText='10']=process.argv.slice(2);
const seedCount=Number(seedCountText);
if(!input||!output||!Number.isInteger(seedCount)||seedCount<1)throw new Error('Usage: verify-ai-replay.mjs report.json output.json [first N seeds per lineup]');
const report=JSON.parse(await readFile(input,'utf8'));
const rows=report.results.filter(r=>r.seed<report.settings.firstSeed+seedCount),started=performance.now();
for(const row of rows) {
  const actual=await playMatch(row,{...report.settings,audit:true});
  for(const key of ['winner','turns','initial','metrics','outcome'])assert.deepEqual(actual[key],row[key],`${row.lineup}/${row.seed}/${row.start}/${row.team}: ${key}`);
}
const result={input,sourceCommit:report.commit,games:rows.length,audit:true,identical:['winner','turns','initial','metrics','outcome'],elapsedSeconds:(performance.now()-started)/1000};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
