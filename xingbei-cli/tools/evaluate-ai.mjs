import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { schedule, playMatch, summary, lineups } from './ai/evaluate.mjs';
import { getPolicy } from '../src/ai/versions.js';
const [candidate='read-1', opponent='v1.0', split='tune', seedText='20', outputArg, selectedArg] = process.argv.slice(2);
const seeds=Number(seedText);
if (!['tune','holdout','selfplay','control','fusion'].includes(split) || !Number.isInteger(seeds) || seeds<1 || seeds>10000) throw new Error('Usage: evaluate-ai.mjs candidate opponent tune|holdout|selfplay|control|fusion seeds [output.json] [comma-separated lineups]');
getPolicy(candidate);getPolicy(opponent);
const selected=selectedArg?.split(',') ?? Object.keys(lineups);
if (selected.some(id=>!Object.hasOwn(lineups,id))) throw new Error('Unknown lineup');
const firstSeed=split==='control'?30001:split==='fusion'?40001:split==='holdout'?10001:split==='selfplay'?20001:1;
const output=resolve(outputArg ?? `xingbei-cli/artifacts/ai/v1.1/${candidate}-${opponent}-${split}.json`);
const started=new Date(), results=[];
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const status=execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim();
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','xingbei-cli/src','xingbei-cli/tools/ai','xingbei-cli/tools/evaluate-ai.mjs'],{encoding:'utf8'}).trim().split('\n').filter(Boolean).sort();
const sourceHashes={};
for(const path of files) sourceHashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');
const settings={candidate,opponent,split,firstSeed,seeds,selected,turnLimit:500,starts:[0,1],colors:['red','blue'],rotation:'seed % 3',bootstrap:'4000 whole-seed resamples across lineups/colors/starts; percentile 95%; truncation scores 0.5'};
for(const config of schedule({firstSeed,seeds,selected})) {
  try { results.push(await playMatch(config,settings)); }
  catch(error) { await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify({settings,commit,status,sourceHashes,error:{config,message:error.stack},results},null,2));throw error; }
  if(results.length%100===0) console.log(`${candidate} ${split}: ${results.length}/${selected.length*seeds*4}`);
}
const report={settings,commit,status,sourceHashes,node:process.version,started:started.toISOString(),elapsedSeconds:(Date.now()-started.getTime())/1000,
  summary:summary(results),byLineup:Object.fromEntries(selected.map(id=>[id,summary(results.filter(r=>r.lineup===id))])),
  byColor:Object.fromEntries(['red','blue'].map(id=>[id,summary(results.filter(r=>r.team===id))])),
  byStart:Object.fromEntries([0,1].map(id=>[id,summary(results.filter(r=>r.start===id))])),results};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({output,elapsedSeconds:report.elapsedSeconds,summary:report.summary,byLineup:Object.fromEntries(Object.entries(report.byLineup).map(([k,v])=>[k,{wins:v.wins,games:v.games,scoreRate:v.scoreRate,ci:v.clusterBootstrap95}]))},null,2));
