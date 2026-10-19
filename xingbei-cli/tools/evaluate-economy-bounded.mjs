import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {playEconomyMatch} from './ai/economy-evaluate.mjs';
import {summary} from './ai/evaluate.mjs';
const [candidate,opponent,output]=process.argv.slice(2);
const phase='bounded-acceptance';
const protocol=JSON.parse(await readFile(new URL('../artifacts/ai/economy/bounded-protocol.json',import.meta.url),'utf8'));
if(!output)throw Error('Usage candidate opponent output');
const rosters={mirrorAssault:['berserker','berserker','windSwordmaster','windSwordmaster','marksman','marksman'],mirrorMixed:['sealer','sealer','guardianAngel','guardianAngel','priest','priest'],asymmetric:['berserker','priest','sealer','marksman','guardianAngel','windSwordmaster'],asymmetricReverse:['priest','berserker','marksman','sealer','windSwordmaster','guardianAngel']};
const settings={candidate,opponent,phase,firstSeed:protocol.firstSeed,seeds:protocol.seeds,starts:protocol.starts,turnLimit:protocol.turnLimit};
const results=[];
for(const [lineup,base] of Object.entries(rosters))for(let i=0;i<settings.seeds;i++)for(const start of settings.starts)for(const team of ['red','blue']) {
 // Swap complete faction rosters as well as policy colors for asymmetric play.
 const heroIds=team==='red'?base:[base[1],base[0],base[3],base[2],base[5],base[4]];
 results.push(await playEconomyMatch({lineup,heroIds,seed:settings.firstSeed+i,start,team},settings));
}
const telemetry=Object.fromEntries(['candidate','opponent'].map(side=>[side,Object.fromEntries(Object.keys(results[0].metrics[side]).map(k=>[k,results.reduce((sum,r)=>sum+r.metrics[side][k],0)]))]));
const report={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),settings,summary:summary(results),telemetry,balancedAsymmetric:summary(results.filter(r=>r.lineup.startsWith('asymmetric'))),byLineup:Object.fromEntries(Object.keys(rosters).map(k=>[k,summary(results.filter(r=>r.lineup===k))])),results};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify({candidate,opponent,phase,summary:report.summary,telemetry}));
