import fs from 'node:fs';
import {playEconomyMatch} from './economy-evaluate.mjs';
const protocol=JSON.parse(fs.readFileSync('artifacts/ai/mandatory-refresh/protocol.json'));
const output=process.argv[2]??'artifacts/ai/v1.5/development.jsonl',games=[];
for(let seed=1501001;seed<=1501004;seed++)for(const[lineup,heroIds]of Object.entries(protocol.rosters))for(const start of protocol.starts)for(const team of protocol.colors){
 const r=await playEconomyMatch({seed,lineup,heroIds,start,team},{candidate:'experimental/plans-2',opponent:'v1.4',turnLimit:300});games.push(r);fs.appendFileSync(output,JSON.stringify(r)+'\n');
 if(games.length%24===0)console.log({games:games.length,wins:games.filter(g=>g.outcome==='win').length,truncated:games.filter(g=>g.outcome==='truncated').length});
}
