import fs from 'node:fs';
import path from 'node:path';
import { driveGame } from '../driver.mjs';
import { teacherIndex } from '../teacher.mjs';
import { encodeEntities, ENTITY_SCHEMA } from './observation.mjs';
import { selectEntityDecision } from './decisions.mjs';
import { HERO_IDS, roster } from './rosters.mjs';
const directory=process.argv[2], count=Number(process.argv[3]??2400);
if (!directory || count<1) throw new Error('collect-all.mjs DIRECTORY [GAMES=2400]');
fs.mkdirSync(path.join(directory,'games'),{recursive:true});
fs.mkdirSync(path.join(directory,'rule-failures'),{recursive:true});
process.env.XINGBEI_DIAGNOSTIC_DIR=path.join(directory,'rule-failures');
const revision=process.env.XINGBEI_SOURCE_REVISION??'development';
const coverage=Object.fromEntries(HERO_IDS.map(id=>[id,0]));
for(let i=0;i<count;i++) {
  const file=path.join(directory,'games',`${i}.json`), heroIds=roster(i);
  if (fs.existsSync(file)) {
    const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (previous.schema !== ENTITY_SCHEMA || previous.result.revision !== revision || JSON.stringify(previous.heroIds) !== JSON.stringify(heroIds))
      throw new Error(`Incompatible resumed corpus: ${file}`);
  } else {
    const retained=Array(6).fill(null), seen=Array(6).fill(0);
    const result=await driveGame({seed:731103000+i,heroIds,start:i%6,capture:true,revision},input=>{
      const choice=teacherIndex(input,'v1.9.0-preview.1');
      return selectEntityDecision(input,(step,answer)=>{
        const observation=encodeEntities(step), seat=step.playerId;
        // Deterministic bounded sampling, independent of the engine's RNG.
        seen[seat]++;
        if (!retained[seat] || ((Math.imul(seen[seat]+i*97,1103515245)>>>0)%seen[seat]===0)) retained[seat]={seat,choice:answer,observation};
        return answer;
      },{teacher:choice});
    });
    if (!result.terminated) throw new Error(`Teacher game truncated: ${result.seed}`);
    fs.writeFileSync(file+'.tmp',JSON.stringify({schema:ENTITY_SCHEMA,teacher:'v1.9.0-preview.1',heroIds,result,decisions:retained.filter(Boolean)}));
    fs.renameSync(file+'.tmp',file);
  }
  for (const id of heroIds) coverage[id]++;
  if (i%12===11 || i===count-1) {
    const progress={completed:i+1,games:count,coverageMinimum:Math.min(...Object.values(coverage))};
    fs.writeFileSync(path.join(directory,'collection-progress.json'),JSON.stringify(progress));
    console.log(JSON.stringify(progress));
  }
}
const data=fs.openSync(path.join(directory,'teacher.jsonl.tmp'),'w'), endings=fs.openSync(path.join(directory,'positions.jsonl.tmp'),'w');
for(let i=0;i<count;i++) {
  const record=JSON.parse(fs.readFileSync(path.join(directory,'games',`${i}.json`)));
  // Whole-game split in train.py uses a shuffled copy, preserving this ordering.
  for(const boundary of record.result.boundaries) fs.writeSync(endings,JSON.stringify({...boundary,sourceSeed:record.result.seed})+'\n');
  delete record.result.boundaries;
  fs.writeSync(data,JSON.stringify(record)+'\n');
}
fs.closeSync(data);fs.closeSync(endings);
for(const file of ['teacher.jsonl','positions.jsonl'])fs.renameSync(path.join(directory,file+'.tmp'),path.join(directory,file));
fs.writeFileSync(path.join(directory,'coverage.json'),JSON.stringify({revision,games:count,coverage},null,2));
