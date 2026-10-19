import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {playEconomyMatch} from './ai/economy-evaluate.mjs';
import {summary} from './ai/evaluate.mjs';
const [candidate,opponent,output]=process.argv.slice(2);
if(!output)throw Error('Usage candidate opponent output');
const protocol=JSON.parse(await readFile(new URL('../artifacts/ai/economy/reverse-roster-protocol.json',import.meta.url),'utf8'));
const base=protocol.baseRoster,settings={candidate,opponent,seeds:protocol.seeds,firstSeed:protocol.firstSeed,turnLimit:300,phase:'reverse-roster-supplement'};
const results=[];
for(let i=0;i<settings.seeds;i++)for(const start of protocol.starts)for(const team of protocol.colors) {
 const heroIds=team==='red'?base:[base[1],base[0],base[3],base[2],base[5],base[4]];
 results.push(await playEconomyMatch({lineup:'asymmetricReverse',heroIds,seed:settings.firstSeed+i,start,team},settings));
}
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify({commit:protocol.candidateCommit,settings,summary:summary(results),results},null,2));
console.log(JSON.stringify({candidate,opponent,games:results.length,summary:summary(results)}));
