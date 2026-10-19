// Reviewable, replayable public decision traces. Constructed states, not screenshots.
import {writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {Game} from '../src/engine.js';
import {getPolicy} from '../src/ai/versions.js';
const output=process.argv[2]??'/tmp/economy-scenarios.json',policy=getPolicy('experimental/economy-2');
const take=(g,id,name)=>g.moveCard(g.deck.find(typeof name==='function'?name:c=>c.name===name).id,{zone:'hand',playerId:id});
const plain=(g,id,name)=>take(g,id,c=>c.name===name&&!c.uniqueSkills.some(s=>['precisionShot','flashTrap'].includes(s)));
const fill=(g,id,n)=>{while(g.player(id).hand.length<n)take(g,id,c=>c.type==='attack');};
const rows=[];
function record(id,g,request=null){const trace=policy.traceDecision(g,0,request);rows.push({id,baseline:request?getPolicy('v1.2').chooseAiRuleDecision(request,g):getPolicy('v1.2').rankAiActions(g,0),trace});}
{
 const g=new Game({seed:19,playerHeroId:'marksman'});for(let i=0;i<6;i++)plain(g,0,'fireStrike');for(const id of [1,2,5])fill(g,id,3);g.player(0).healing=2;g.teams.red.morale=1;
 const seal=g.deck.find(c=>c.hasUniqueSkill('fireSeal'));g.attachCard(seal.id,0,{effectId:'fireSeal',sourcePlayerId:1});record('current-benefit-reversed-by-next-turn-danger',g);
}
{
 const g=new Game({seed:19,playerHeroId:'sealer'});take(g,0,'darkStrike');take(g,0,'holyLight');take(g,0,'holyLight');for(const id of [1,2,5])fill(g,id,3);g.startTurn(0);g.turn.state.completed=true;g.turn.state.pendingActions=[{type:'attack',sourceSkillId:'spellExcitation'}];
 record('extra-dark-vs-three',g);g.teams.red.morale=1;record('extra-dark-emergency-defense',g);fill(g,1,6);record('extra-dark-vs-full',g);
}
{
 const g=new Game({seed:19,playerHeroId:'marksman'});for(let i=0;i<3;i++)plain(g,0,'fireStrike');for(let i=0;i<2;i++)plain(g,0,'windStrike');take(g,0,c=>c.hasUniqueSkill('precisionShot')&&c.elements.includes('earth'));for(const id of [1,2,5])fill(g,id,4);
 record('three-fire-two-wind-one-earth',g);g.addStones('red','crystal',2);record('full-hand-refine-alternative',g);
 const seal=g.deck.find(c=>c.hasUniqueSkill('fireSeal'));g.attachCard(seal.id,0,{effectId:'fireSeal',sourcePlayerId:1});record('fire-seal-changes-net-state',g);
}
{
 const g=new Game({seed:19,heroIds:['priest','berserker','sealer','marksman','guardianAngel','windSwordmaster']});take(g,0,c=>c.name==='poison'&&c.elements.includes('water'));plain(g,0,'fireStrike');take(g,0,'holyLight');fill(g,3,5);fill(g,4,6);const seal=g.deck.find(c=>c.hasUniqueSkill('fireSeal'));g.attachCard(seal.id,3,{effectId:'fireSeal',sourcePlayerId:1});record('priest-transfer-to-congested-sealed-teammate',g);
}
{
 const g=new Game({seed:19,playerHeroId:'marksman'});for(let i=0;i<3;i++)take(g,0,'magicBullet');for(let i=0;i<3;i++)plain(g,0,'fireStrike');fill(g,1,1);
 const request=()=>({type:'cardChoice',playerId:0,skillId:'piercingShot',count:1,valid:g.player(0).hand.map((c,i)=>c.type==='spell'?i:null).filter(i=>i!==null),optional:true,context:{targetId:1}});
 record('piercing-shedding-outweighs-enemy-refill',g,request());for(const c of [...g.player(0).hand].slice(3))g.moveCard(c.id,{zone:'discard'});record('piercing-low-burden-declines',g,request());
}
for(const row of rows){const trace=JSON.parse(JSON.stringify(row.trace));const replay=policy.replayTrace(trace);if(JSON.stringify(replay)!==JSON.stringify(trace.request?trace.decision:trace.candidates))throw Error(`Replay differs: ${row.id}`);}
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify({scope:'constructed, not screenshot replay',rows},null,2));console.log(JSON.stringify(rows.map(r=>({id:r.id,baseline:Array.isArray(r.baseline)&&r.baseline[0]?.action?r.baseline[0]:r.baseline,candidate:r.trace.request?r.trace.decision:r.trace.candidates[0]})),null,2));
