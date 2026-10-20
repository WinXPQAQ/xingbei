import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import fs from 'node:fs';import os from 'node:os';import {getPolicy} from '../../src/ai/versions.js';
const {snapshots}=JSON.parse(fs.readFileSync('artifacts/ai/targeted-fixes-1/confirmation/stress-snapshots.json'));
console.log(Object.keys(snapshots[0]));
const records=[],versions=['experimental/targeted-fixes-1','experimental/plans-3'];
for(let repeat=0;repeat<6;repeat++)for(let i=0;i<snapshots.length;i++)for(const version of (i+repeat)%2?versions:[...versions].reverse()){
 const x=snapshots[i],start=performance.now();getPolicy(version).replayTrace({version,observation:x.observation});const ms=performance.now()-start;
 if(repeat)records.push({index:i,hero:x.observation.players[x.observation.observerId].hero.id,group:x.cell,repeat,version,ms});
}
const stat=a=>{a.sort((a,b)=>a-b);return {median:a[Math.floor(a.length/2)],p95:a[Math.floor(a.length*.95)],max:a.at(-1)}};
const groups={};for(const r of records){const key=r.hero+':'+(r.group??Math.floor(r.index%30/10));(groups[key]??={})[r.version]??=[];groups[key][r.version].push(r.ms);}
const sourceFiles=['src/ai/v1.5-candidate/model.js','src/ai/v1.5-candidate/planner.js','src/ai/v1.5-candidate/index.js','src/ai/v1.5-candidate/horizon.js'];
const result={baseSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceHashes:Object.fromEntries(sourceFiles.map(f=>[f,createHash('sha256').update(fs.readFileSync(f)).digest('hex')])),node:process.version,cpu:os.cpus()[0].model,records,groups:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,Object.fromEntries(Object.entries(v).map(([k,a])=>[k,stat(a)]))]))};
fs.writeFileSync('artifacts/ai/v1.5/development-performance.json',JSON.stringify(result,null,2));console.log(result.groups);
