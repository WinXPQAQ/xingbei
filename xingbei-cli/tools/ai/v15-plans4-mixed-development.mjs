import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {playEconomyMatch} from './economy-evaluate.mjs';
const root='artifacts/ai/v1.5/plans4-final-development';
const mode=process.argv[2]??'manifest';
if(mode==='manifest'){
 fs.mkdirSync(root,{recursive:true});
 const rosters=JSON.parse(fs.readFileSync('artifacts/ai/mandatory-refresh/protocol.json')).rosters,games=[];
 for(const seed of [1501001,1501002])for(const style of ['flow','reserve'])for(const [lineup,b]of Object.entries(rosters))for(const start of [0,3])for(const team of ['red','blue'])for(const seat of team==='red'?[0,3,4]:[1,2,5])for(const candidate of ['v1.4','experimental/plans-4']){
  const seats=team==='red'?[0,3,4]:[1,2,5],heroIds=team==='red'?b:[b[1],b[0],b[3],b[2],b[5],b[4]];
  const config={seed,lineup,heroIds,start,team,seatPolicies:Array.from({length:6},(_,id)=>id===seat?candidate:seats.includes(id)?`experimental/style-${style}`:'v1.4')};
  games.push({id:games.length,style,seat,candidate,config,reuse:seed===1501001&&candidate==='v1.4'});
 }
 const files=['model.js','planner.js','index.js','horizon.js'].map(f=>`src/ai/v1.5-candidate/${f}`).concat('src/ai/observation.js');
 fs.writeFileSync(`${root}/manifest.json`,JSON.stringify({games,hashes:Object.fromEntries(files.map(f=>[f,createHash('sha256').update(fs.readFileSync(f)).digest('hex')]))},null,2),{flag:'wx'});
 const previous=fs.readFileSync('artifacts/ai/v1.5/plans3-mixed-matched-development.jsonl','utf8').trim().split('\n').map(JSON.parse);
 const reused=games.filter(g=>g.reuse).map(g=>{
  const r=previous.find(r=>r.candidate===g.candidate&&r.seed===g.config.seed&&r.style===g.style&&r.seat===g.seat&&r.lineup===g.config.lineup&&r.start===g.config.start&&r.team===g.config.team);
  if(!r||JSON.stringify(r.seatPolicies)!==JSON.stringify(g.config.seatPolicies))throw Error('Missing identical control');
  return {...r,...g,reusedFrom:'plans3-mixed-matched-development.jsonl'};
 });
 fs.writeFileSync(`${root}/reused.jsonl`,reused.map(r=>JSON.stringify(r)).join('\n')+'\n',{flag:'wx'});
 console.log({games:games.length,reused:reused.length,new:games.length-reused.length});
}else if(mode==='run'){
 const exits=await Promise.all(Array.from({length:4},(_,shard)=>new Promise(resolve=>{
  const log=fs.openSync(`${root}/run-${shard}.log`,'wx'),child=spawn(process.execPath,[import.meta.filename,String(shard)],{stdio:['ignore',log,log]});
  child.on('error',error=>resolve({shard,error:String(error)}));child.on('exit',code=>{fs.closeSync(log);resolve({shard,code});});
 })));
 fs.writeFileSync(`${root}/runner-exit.json`,JSON.stringify(exits,null,2));console.log(exits);
 if(exits.some(e=>e.code!==0))process.exitCode=1;
}else{
 const manifest=JSON.parse(fs.readFileSync(`${root}/manifest.json`));
 for(const [file,hash]of Object.entries(manifest.hashes))if(createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==hash)throw Error('Source changed');
 const shard=Number(mode),file=`${root}/games-${shard}.jsonl`;
 if(fs.existsSync(file))throw Error('Do not overwrite diagnostic');
 // Assign sequential new rows so both candidate and control arms distribute.
 for(const row of manifest.games.filter(g=>!g.reuse).filter((g,i)=>i%4===shard)){
  const result=await playEconomyMatch(row.config,{candidate:row.candidate,opponent:'v1.4',turnLimit:300,audit:true});
  fs.appendFileSync(file,JSON.stringify({...row,...result})+'\n');
 }
}
