import fs from 'node:fs';
const number=process.argv[2]??'1',root=`artifacts/ai/team-route-${number}/`,files=Array.from({length:7},(_,i)=>JSON.parse(fs.readFileSync(root+`confirmation-${i}.json`)));
const score=r=>r.outcome==='win'?1:r.outcome==='loss'?0:.5;
function estimate(xs){const bySeed=new Map();for(const r of xs){if(!bySeed.has(r.seed))bySeed.set(r.seed,[]);bySeed.get(r.seed).push(r.value);}const vals=[...bySeed.values()].map(a=>a.reduce((s,x)=>s+x,0)/a.length);let rng=918273;const random=()=>((rng=(Math.imul(rng,1664525)+1013904223)>>>0)/2**32);const samples=Array.from({length:4000},()=>vals.reduce(s=>s+vals[Math.floor(random()*vals.length)],0)/vals.length).sort((a,b)=>a-b);return {games:xs.length,seeds:vals.length,mean:vals.reduce((a,b)=>a+b,0)/vals.length,cluster95:[samples[100],samples[3899]]};}
const key=r=>[r.seed,r.lineup,r.start,r.team].join('/'),baseline=new Map(files[3].results.map(r=>[key(r),r]));
const corrected={};for(const group of ['all',...Object.keys(files[0].groups)]){const rows=files[0].results.filter(r=>group==='all'||r.lineup===group);corrected[group]=estimate(rows.map(r=>({seed:r.seed,value:score(r)-score(baseline.get(key(r)))})));}
const ablations=files.slice(4).map(r=>{const primary=new Map(files[0].results.map(x=>[key(x),x]));return{candidate:r.candidate,summary:r.summary,pairedFullMinusAblated:estimate(r.results.map(x=>({seed:x.seed,value:score(primary.get(key(x)))-score(x)})))};});
const pct=x=>(100*x).toFixed(2)+'%',ci=a=>a.map(pct).join('–');
const performance=JSON.parse(fs.readFileSync(root+'performance.json'));
const s=files[0].summary,statsGate=s.scoreRate>.5&&s.clusterBootstrap95[0]>=.45&&Object.entries(corrected).filter(([k])=>k!=='all').every(([,s])=>s.mean>=-.05)&&files.slice(1,3).every(r=>r.summary.scoreRate>=.5)&&files.every(r=>r.summary.truncated/r.summary.games<=.01)&&performance.ratios.median<=2&&performance.ratios.p95<=3;
const detail=files.map(r=>({sha:r.sha,candidate:r.candidate,opponent:r.opponent,summary:r.summary,groups:r.groups,byStart:Object.fromEntries([0,1,2,3,4,5].map(start=>[start,estimate(r.results.filter(x=>x.start===start).map(x=>({seed:x.seed,value:score(x)})))])),byColor:Object.fromEntries(['red','blue'].map(team=>[team,estimate(r.results.filter(x=>x.team===team).map(x=>({seed:x.seed,value:score(x)})))]))}));
fs.writeFileSync(root+'summary.json',JSON.stringify({statsGate,corrected,ablations,detail,performance},null,2));
let out='\n## 完整确认统计\n\n| 候选/对手 | 胜/负/截断 | 得分率 | 簇95%区间 |\n|---|---:|---:|---|\n';for(const r of files)out+=`| ${r.candidate}/${r.opponent} | ${r.summary.wins}/${r.summary.losses}/${r.summary.truncated} | ${pct(r.summary.scoreRate)} | ${ci(r.summary.clusterBootstrap95)} |\n`;
out+='\n相对同配置v1.3自博弈的配对差（百分点，按完整种子簇抽样）：\n\n| 分组 | 差 | 簇95%区间 |\n|---|---:|---|\n';for(const [k,s] of Object.entries(corrected))out+=`| ${k} | ${pct(s.mean)} | ${ci(s.cluster95)} |\n`;
out+='\n| 完整候选减去消融 | 配对差 | 簇95%区间 |\n|---|---:|---|\n';for(const a of ablations)out+=`| ${a.candidate} | ${pct(a.pairedFullMinusAblated.mean)} | ${ci(a.pairedFullMinusAblated.cluster95)} |\n`;
out+=`\n预登记统计/性能门：${statsGate?'通过':'未通过'}。这不覆盖独立发现的模型语义阻断；不能单凭胜率允许上线。主项仅8簇，消融4簇；未进行多重比较确认推断。完整阵容/先手/颜色细分见summary.json，全部原始逐局保留。\n`;
fs.writeFileSync(root+'tables.md',out);console.log(out);
