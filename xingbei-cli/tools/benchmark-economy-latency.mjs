// Same live, legally reached states for both policies; measured policies never
// drive these games. Snapshots and assertions are outside the timed interval.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {cpus} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {Game} from '../src/engine.js';
import {getPolicy} from '../src/ai/versions.js';

const output=process.argv[2]??'/tmp/economy-latency.json';
const candidate=process.argv[3]??'experimental/economy-3';
const names=['v1.2',candidate],policies=names.map(getPolicy),driver=getPolicy('v1.2');
const heroes=['berserker','windSwordmaster','marksman','sealer','guardianAngel','priest'];
const settings={seeds:[61011,61012,61013,61014],turnLimit:72,perSeedHeroKindLimit:2,warmups:1,repeats:3,driver:'v1.2',policies:names};
const samples=[],counts=new Map(),games=[];
const snapshot=g=>JSON.stringify({game:g.toJSON(),cards:[...g.cards.values()].map(c=>c.toJSON()),history:g.publicHistory,presentation:g.presentationEvents});
const hash=s=>createHash('sha256').update(s).digest('hex');
function measure(g,id,kind,request,source,force=false) {
 const hero=g.player(id).hero.id,key=`${source.seed}/${hero}/${kind}`;
 if(!force&&(counts.get(key)??0)>=settings.perSeedHeroKindLimit)return;
 counts.set(key,(counts.get(key)??0)+1);
 const before=snapshot(g),sample={source,id,hero,kind,requestType:request?.type??null,skillId:request?.skillId??null,stateHash:hash(before),milliseconds:{}};
 const invoke=policy=>kind==='action'?policy.chooseAiAction(g,id):kind==='response'?policy.chooseAiResponse(g,request):request.type==='overflow'?policy.chooseAiDiscard(g,id,Math.max(0,g.player(id).hand.length-g.player(id).handLimit)):policy.chooseAiRuleDecision(request,g);
 // Alternate ordering to avoid always giving one policy the colder runtime.
 const order=samples.length%2?[1,0]:[0,1];
 for(const index of order) {
  const policy=policies[index];let decision;
  for(let i=0;i<settings.warmups;i++){decision=invoke(policy);assert.equal(snapshot(g),before,'Warmup mutated game');}
  const timings=[];
  for(let i=0;i<settings.repeats;i++) {
   const start=performance.now(),result=invoke(policy);timings.push(performance.now()-start);
   assert.equal(snapshot(g),before,'Timed decision mutated game');assert.deepEqual(result,decision,'Repeated decision changed');
  }
  sample.milliseconds[names[index]]=timings;
 }
 samples.push(sample);
}
for(const seed of settings.seeds) {
 const g=new Game({seed,heroIds:heroes}).setup();g.current=(seed-settings.seeds[0])%6;let turns=0;
 const source={seed};
 function decide(r) {
  const id=r.playerId??r.player?.id??r.target?.id;
  measure(g,id,r.type==='response'?'response':'rule',r,source);
  if(r.type==='response')return driver.chooseAiResponse(g,r);
  if(r.type==='overflow')return g.resolveOverflow(id,driver.chooseAiDiscard(g,id,g.player(id).hand.length-g.player(id).handLimit));
  return driver.chooseAiRuleDecision(r,g);
 }
 const options={choose:decide,chooseResponse:decide,resolveOverflow:decide,overflow:(player,excess)=>driver.chooseAiDiscard(g,player.id,excess)};
 g.automaticDecision=decide;
 while(!g.winner&&turns<settings.turnLimit) {
  turns++;const id=g.current,turn=await g.beginTurn(id,{choose:decide,chooseWeakness:decide,resolveOverflow:decide},options);
  if(!turn.skipped&&!g.winner) {
   let actions=0;
   do {
    assert.ok(++actions<=20,'Action loop');measure(g,id,'action',null,source);
    const action=driver.chooseAiAction(g,id);
    if(action.type==='pass'){if(g.turn.hasExtraActions())g.skipExtraActions(id);break;}
    await g.executeAction(id,action,options);g.assertCardLocations();
   }while(g.turn.hasExtraActions()&&!g.winner);
  }
  await g.endTurnWithDecisions(options);g.assertCardLocations();
 }
 games.push({seed,turns,winner:g.winner});
}
// Explicitly synthetic stress fixture, never mixed into reachable-state totals.
const stress=new Game({seed:61011,playerHeroId:'windSwordmaster'});
for(let i=0;i<6;i++)stress.moveCard(stress.deck.find(c=>c.name==='windStrike').id,{zone:'hand',playerId:0});
for(const id of [1,2,5])for(let i=0;i<6;i++)stress.moveCard(stress.deck[0].id,{zone:'hand',playerId:id});
stress.player(0).energy.crystal=2;stress.startTurn(0);
for(let i=0;i<256;i++)stress.publicHistory.append({type:'turn',playerId:i%6});
measure(stress,0,'action',null,{stress:'six-wind-two-energy-256-turn-events'},true);
const quantile=(values,p)=>values[Math.max(0,Math.ceil(values.length*p)-1)]??null;
function summarize(selected) {
 return Object.fromEntries(names.map(name=>{const times=selected.flatMap(s=>s.milliseconds[name]).sort((a,b)=>a-b);return [name,{states:selected.length,timedCalls:times.length,p50:quantile(times,.5),p95:quantile(times,.95),max:times.at(-1)??null}];}));
}
const reachable=samples.filter(s=>!s.source.stress);
const report={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,cpu:cpus()[0]?.model,settings,games,
 limitations:['Node wall-clock timings on this machine, not browser frame-time or human-strength evidence.','Only fixed v1.2 trajectories; per-hero/type sample cap can omit rare requests.','Overflow times pure discard selection; execution is excluded.','Warmups, snapshot validation and engine execution excluded from timings.','Three timings per state are correlated repeats, not independent positions.'],
 reachable:summarize(reachable),byKind:Object.fromEntries(['action','response','rule'].map(k=>[k,summarize(reachable.filter(s=>s.kind===k))])),
 byHero:Object.fromEntries(heroes.map(h=>[h,Object.fromEntries(['action','response','rule'].map(k=>[k,summarize(reachable.filter(s=>s.hero===h&&s.kind===k))]))])),
 stress:summarize(samples.filter(s=>s.source.stress)),samples};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({output,reachable:report.reachable,byKind:report.byKind,stress:report.stress}));
