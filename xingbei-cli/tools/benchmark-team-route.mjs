import fs from 'node:fs';import {performance} from 'node:perf_hooks';
import {getPolicy} from '../src/ai/versions.js';import {observationView} from '../src/ai/observation.js';
const cases=[0,1].flatMap(i=>JSON.parse(fs.readFileSync(`artifacts/ai/mandatory-refresh/pair-${i}.json`)).cases);
const times={};for(const version of ['experimental/economy-capability-1','experimental/team-route-1']){
 const policy=getPolicy(version),samples=[];
 for(let repeat=0;repeat<4;repeat++)for(const c of cases){const g=observationView(c.observation),start=performance.now();policy.replayTrace({version,observation:c.observation});if(repeat)samples.push(performance.now()-start);}
 samples.sort((a,b)=>a-b);times[version]={samples:samples.length,medianMs:samples[Math.floor(samples.length*.5)],p95Ms:samples[Math.floor(samples.length*.95)]};
}
const [a,b]=Object.values(times),ratios={median:b.medianMs/a.medianMs,p95:b.p95Ms/a.p95Ms};fs.writeFileSync('artifacts/ai/team-route-1/performance.json',JSON.stringify({times,ratios,scope:'same-process 10 archived public observations ×3 measured repetitions; not entire match latency'},null,2));console.log({times,ratios});
