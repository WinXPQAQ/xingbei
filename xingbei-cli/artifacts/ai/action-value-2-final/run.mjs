import fs from 'node:fs';import {execFileSync} from 'node:child_process';
import {playEconomyMatch} from '../../../tools/ai/economy-evaluate.mjs';
const dir=new URL('./',import.meta.url),p=JSON.parse(fs.readFileSync(new URL('protocol.json',dir))),{rosters}=JSON.parse(fs.readFileSync(p.rostersSource));
const job=Number(process.argv[2]),[candidate,opponent]=p.pairs[job];
function freeze(){execFileSync('git',['diff','--exit-code',p.sourceSHA,'--','src','tools','test']);}
freeze();const file=new URL(`games-${job}.jsonl`,dir);const prior=fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
const key=x=>[x.seed,x.lineup,x.start,x.team].join('/'),seen=new Set(prior.map(key));
let done=prior.length;
try {for(let seed=p.firstSeed;seed<=p.lastSeed;seed++)for(const [lineup,b]of Object.entries(rosters))for(const start of p.starts)for(const team of p.teams){
 const config={seed,lineup,start,team,heroIds:team==='red'?b:p.blueMapping.map(i=>b[i])};if(seen.has(key(config)))continue;
 const result=await playEconomyMatch(config,{candidate,opponent,turnLimit:p.turnLimit,audit:true,observations:true});
 fs.appendFileSync(file,JSON.stringify(result)+'\n');done++;if(done%48===0)console.log(JSON.stringify({job,completed:done,total:p.gamesPerPair}));
}freeze();fs.writeFileSync(new URL(`complete-${job}.json`,dir),JSON.stringify({job,candidate,opponent,sourceSHA:p.sourceSHA,deliverySHA:p.deliverySHA,count:done},null,2));}
catch(e){fs.appendFileSync(new URL(`errors-${job}.log`,dir),new Date().toISOString()+' '+e.stack+'\n');throw e;}
