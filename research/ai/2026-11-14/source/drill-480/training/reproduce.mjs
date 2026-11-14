import fs from 'node:fs';
import { driveGame } from './driver.mjs';
import { digest } from './entity/replay.mjs';
const record=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
let index=0;
await driveGame(record.config, input=>{
  const step=record.replayPrefix[index++];
  if (!step || digest(input.candidates)!==step.candidatesHash) throw new Error('Stored trace exhausted or diverged');
  return step.index;
});
