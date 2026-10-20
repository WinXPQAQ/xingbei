import fs from 'node:fs';import {spawn} from 'node:child_process';
const root='artifacts/ai/v1.5/confirmation-4';
const results=await Promise.all(Array.from({length:4},(_,shard)=>new Promise(resolve=>{const log=fs.openSync(`${root}/run-${shard}.log`,'wx');const child=spawn(process.execPath,['tools/ai/v15-paired-confirm.mjs',String(shard),'4'],{stdio:['ignore',log,log]});child.on('error',error=>resolve({shard,error:String(error)}));child.on('exit',code=>{fs.closeSync(log);resolve({shard,code});});})));
fs.writeFileSync(`${root}/runner-exit.json`,JSON.stringify(results,null,2));console.log(results);if(results.some(r=>r.code!==0))process.exitCode=1;
