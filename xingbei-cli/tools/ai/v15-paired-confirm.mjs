import fs from 'node:fs';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';import {playEconomyMatch} from './economy-evaluate.mjs';
const root='artifacts/ai/v1.5/confirmation-4',mode=process.argv[2]??'manifest';fs.mkdirSync(root,{recursive:true});
const sha=()=>execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(mode==='manifest'){
 const {rosters,starts,colors}=JSON.parse(fs.readFileSync('artifacts/ai/mandatory-refresh/protocol.json')),games=[];
 for(const [endpoint,seeds,opponent,style]of [['v1.4',120,'v1.4'],['v1.3',20,'v1.3'],['v1.2',20,'v1.2'],['v1.0',20,'v1.0'],['flow',30,'v1.4','experimental/style-flow'],['reserve',30,'v1.4','experimental/style-reserve']])for(let seed=1540001;seed<1540001+seeds;seed++)for(const[lineup,b]of Object.entries(rosters))for(const start of starts)for(const team of colors){
  const heroIds=team==='red'?b:[b[1],b[0],b[3],b[2],b[5],b[4]],seats=team==='red'?[0,3,4]:[1,2,5];
  for(const seat of style?seats:[null])for(const arm of style?['candidate','control']:['candidate']){const config={seed,lineup,heroIds,start,team};if(style)config.seatPolicies=Array.from({length:6},(_,id)=>id===seat?(arm==='candidate'?'experimental/plans-4':'v1.4'):seats.includes(id)?style:opponent);games.push({id:games.length,endpoint,opponent,seat,arm,pairId:style?[endpoint,seed,lineup,start,team,seat].join(':'):null,config});}
 }
 if(games.length!==25920)throw Error('Unexpected manifest size');
 const files=execFileSync('git',['ls-files','src','tools/ai','test'],{encoding:'utf8'}).trim().split('\n');const hashes=Object.fromEntries(files.map(f=>[f,createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
 fs.writeFileSync(`${root}/manifest.json`,JSON.stringify({sha:sha(),created:new Date().toISOString(),games,hashes},null,2),{flag:'wx'});console.log({games:games.length,sha:sha()});
}else{
 const manifest=JSON.parse(fs.readFileSync(`${root}/manifest.json`));if(sha()!==manifest.sha)throw Error('Candidate SHA changed');for(const[file,hash]of Object.entries(manifest.hashes))if(createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==hash)throw Error(`Frozen file changed: ${file}`);
 const shard=Number(mode),count=Number(process.argv[3]??4),file=`${root}/games-${shard}.jsonl`;if(fs.existsSync(file))throw Error('Do not overwrite confirmation');
 for(const row of manifest.games.filter(g=>g.id%count===shard)){
  const result=await playEconomyMatch(row.config,{candidate:row.arm==='control'?'v1.4':'experimental/plans-4',opponent:row.opponent,turnLimit:300,audit:true});fs.appendFileSync(file,JSON.stringify({...row,...result})+'\n');
  if(row.id%(count*48)===shard)console.log({id:row.id,endpoint:row.endpoint});
 }
 fs.writeFileSync(`${root}/complete-${shard}.json`,JSON.stringify({sha:manifest.sha,finished:new Date().toISOString(),shard,count}));
}
