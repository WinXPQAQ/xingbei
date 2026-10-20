import fs from 'node:fs';
import {playEconomyMatch} from '/workspace/xingbei/xingbei-cli/tools/ai/economy-evaluate.mjs';
const rosters=JSON.parse(fs.readFileSync('artifacts/ai/mandatory-refresh/protocol.json')).rosters;
const output='artifacts/ai/v1.5/plans3-mixed-matched-development.jsonl';
for(const style of ['flow','reserve'])for(const [lineup,b]of Object.entries(rosters))for(const start of [0,3])for(const team of ['red','blue'])for(const seat of team==='red'?[0,3,4]:[1,2,5])for(const candidate of ['v1.4','experimental/plans-3']){
 const seats=team==='red'?[0,3,4]:[1,2,5],heroIds=team==='red'?b:[b[1],b[0],b[3],b[2],b[5],b[4]];
 const config={seed:1501001,lineup,heroIds,start,team,seatPolicies:Array.from({length:6},(_,id)=>id===seat?candidate:seats.includes(id)?`experimental/style-${style}`:'v1.4')};
 const result=await playEconomyMatch(config,{candidate,opponent:'v1.4',turnLimit:300,audit:true});fs.appendFileSync(output,JSON.stringify({style,seat,candidate,...result})+'\n');
}
