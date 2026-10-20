import fs from 'node:fs';
import {playEconomyMatch} from './economy-evaluate.mjs';
const protocol=JSON.parse(fs.readFileSync('artifacts/ai/mandatory-refresh/protocol.json'));
const output=process.argv[2]??'artifacts/ai/v1.5/plans4-team-development.jsonl',games=[];
if(fs.existsSync(output))throw Error('Do not overwrite development');
for(let seed=1501001;seed<=1501004;seed++)for(const[lineup,heroIds]of Object.entries(protocol.rosters))for(const start of protocol.starts)for(const team of protocol.colors){
 const roster=team==='red'?heroIds:[heroIds[1],heroIds[0],heroIds[3],heroIds[2],heroIds[5],heroIds[4]];
 const r=await playEconomyMatch({seed,lineup,heroIds:roster,start,team},{candidate:'experimental/plans-4',opponent:'v1.4',turnLimit:300});games.push(r);fs.appendFileSync(output,JSON.stringify(r)+'\n');
 if(games.length%24===0)console.log({games:games.length,wins:games.filter(g=>g.outcome==='win').length,truncated:games.filter(g=>g.outcome==='truncated').length});
}
