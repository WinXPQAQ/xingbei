// Fixed diagnostic sampling; never used to tune or gate the frozen candidate.
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {Game,Timing} from '../src/engine.js';
import {getPolicy} from '../src/ai/versions.js';
import {captureObservation,observationView} from '../src/ai/observation.js';
import {stateOf,energyPlan} from '../src/ai/v1.3/model.js';
const root=new URL('../artifacts/ai/economy/',import.meta.url);
const reference=JSON.parse(await readFile(new URL('bounded/experimental_economy-2--v1.2.json',root),'utf8'));
// Fixed before inspecting trajectories: first acceptance seed, start0, all four
// rosters and both colors, in existing protocol order. First high-hand action per
// policy/hero, plus first high-hand refinement and first gift per policy/hero/initiating-action-class.
const configs=reference.results.filter(r=>r.seed===82001&&r.start===0);
const samples=[],gifts=[],matches=[],giftCounts={},seen=new Set(),seenRefine=new Set(),seenGift=new Set();
const normalize=x=>JSON.parse(JSON.stringify(x));
for(const config of configs){
 const game=new Game({seed:config.seed,heroIds:config.heroIds}).setup();game.current=config.start;
 const names={red:config.team==='red'?'experimental/economy-2':'v1.2',blue:config.team==='blue'?'experimental/economy-2':'v1.2'};
 const policy=id=>getPolicy(names[game.player(id).team]),events=[],pending=[],pendingGifts=[];let turns=0,arriving=[];
 const snapshot=id=>{const p=game.player(id),s=stateOf(observationView(captureObservation(game,id)),id);return {id,hero:p.hero.id,team:p.team,handCount:p.hand.length,limit:p.handLimit,hand:p.hand.map(c=>({id:c.id,name:c.name,type:c.type,elements:[...c.elements],uniqueSkills:[...c.uniqueSkills]})),energy:{...p.energy},modeledEnergyOption:energyPlan(s,s.players[id]),healing:p.healing,morale:game.teams[p.team].morale,effects:p.statuses.map(c=>c.attachment.effectId)};};
 const morale=game.changeMorale;game.changeMorale=function(team,n){const before=this.teams[team].morale,result=morale.call(this,team,n);events.push({type:'morale',turn:turns,team,delta:this.teams[team].morale-before});return result;};
 const trigger=game.trigger;game.trigger=function*(timing,context,options){yield* trigger.call(this,timing,context,options);if(timing===Timing.DAMAGE_ACTUAL)events.push({type:'damage',turn:turns,targetId:context.targetId,sourceId:context.sourceId,actual:context.actual,damageType:context.damageType});};
 const energy=game.paySkillEnergy;game.paySkillEnergy=function*(id,kind,count=1){const before={...this.player(id).energy};const result=yield* energy.call(this,id,kind,count);events.push({type:'energyPayment',turn:turns,playerId:id,kind,count,before,after:{...this.player(id).energy}});return result;};
 const healing=game.changeHealing;game.changeHealing=function(id,amount,options){const before=this.player(id).healing,result=healing.call(this,id,amount,options);events.push({type:'healing',turn:turns,playerId:id,delta:this.player(id).healing-before});return result;};
 const logSkill=game.logSkill;game.logSkill=function(id,skillId,detail){const result=logSkill.call(this,id,skillId,detail);events.push({type:'skill',turn:turns,playerId:id,skillId,detail});return result;};
 const give=game.giveCards;game.giveCards=function(id,targetId,cards){const p=this.player(id),key=names[p.team]+'/'+p.hero.id;let sample;
  const initiatingAction=events.findLast(e=>e.type==='action')??null;const giftKey=key+'/'+(initiatingAction?.action.skillId??initiatingAction?.action.type??'none');giftCounts[giftKey]=(giftCounts[giftKey]??0)+1;
  if(!seenGift.has(giftKey)){seenGift.add(giftKey);sample={config:{lineup:config.lineup,seed:config.seed,start:config.start,team:config.team},policy:names[p.team],initiatingAction,donor:id,donorHero:p.hero.id,targetId,turn:turns,donorBefore:snapshot(id),recipientBefore:snapshot(targetId),given:cards.map(c=>({id:c.id,name:c.name,elements:[...c.elements]})),eventStart:events.length};gifts.push(sample);pendingGifts.push(sample);}
  const result=give.call(this,id,targetId,cards);events.push({type:'gift',turn:turns,donor:id,targetId,count:cards.length});if(sample){sample.donorAfter=snapshot(id);sample.recipientAfter=snapshot(targetId);}return result;};
 const discard=(id,n)=>policy(id).chooseAiDiscard(game,id,n);
 const options={overflow:(p,n)=>discard(p.id,n),choose:r=>decide(r),chooseResponse:r=>policy(r.target.id).chooseAiResponse(game,r),resolveOverflow:r=>game.resolveOverflowWithDecisions(r.player.id,discard(r.player.id,r.player.hand.length-r.player.handLimit),options)};
 function decide(r){if(r.type==='response')return options.chooseResponse(r);if(r.type==='overflow')return options.resolveOverflow(r);const id=r.playerId??r.player?.id;if(id==null)throw Error('unrouted');return policy(id).chooseAiRuleDecision(r,game);}
 game.automaticDecision=decide;
 const finish=(sample,id)=>{sample.nextAction=snapshot(id);sample.nextActionTurn=turns;sample.events=events.slice(sample.eventStart);sample.censored=false;arriving.push(sample);};
 while(!game.winner&&turns<300){arriving=[];turns++;const id=game.current;const turn=await game.beginTurn(id,{choose:options.choose,chooseWeakness:options.choose,resolveOverflow:options.resolveOverflow},options);
  if(!turn.skipped&&!game.winner){
   for(let i=pending.length-1;i>=0;i--)if(pending[i].actorId===id){finish(pending[i],id);pending.splice(i,1);}
   for(let i=pendingGifts.length-1;i>=0;i--)if(pendingGifts[i].targetId===id){finish(pendingGifts[i],id);pendingGifts.splice(i,1);}
   let count=0;do{if(++count>20)throw Error('action limit');const p=game.player(id),action=policy(id).chooseAiAction(game,id),key=names[p.team]+'/'+p.hero.id;
    let sample=null;const high=p.hand.length>=p.handLimit-1,first=high&&!seen.has(key),refine=high&&action.type==='refine'&&!seenRefine.has(key);
    if(first||refine){seen.add(key);if(refine)seenRefine.add(key);const ranks=policy(id).rankAiActions(game,id);sample={config:{lineup:config.lineup,seed:config.seed,start:config.start,team:config.team},policy:names[p.team],actorId:id,hero:p.hero.id,turn:turns,reason:first?'first-high-hand':'first-high-hand-refine',before:snapshot(id),action,legalPlayIndices:[...new Set(ranks.filter(r=>r.action.type==='play').map(r=>r.action.index))],ranks:normalize(ranks),eventStart:events.length};samples.push(sample);pending.push(sample);}
    events.push({type:'action',turn:turns,actorId:id,action:normalize(action)});
    const nextEventStart=events.length-1;if(count===1)for(const prior of arriving)prior.nextTurnFirstAction=normalize(action);
    if(action.type==='pass'){if(game.turn.hasExtraActions())game.skipExtraActions(id);if(sample)sample.afterAction=snapshot(id);if(count===1)for(const prior of arriving){prior.afterNextTurnFirstAction=snapshot(id);prior.nextTurnFirstActionEvents=events.slice(nextEventStart);}break;}
    await game.executeAction(id,action,options);game.assertCardLocations();if(sample)sample.afterAction=snapshot(id);if(count===1)for(const prior of arriving){prior.afterNextTurnFirstAction=snapshot(id);prior.nextTurnFirstActionEvents=events.slice(nextEventStart);}
   }while(game.turn.hasExtraActions()&&!game.winner);
  }
  await game.endTurnWithDecisions(options);game.assertCardLocations();
 }
 for(const sample of [...pending,...pendingGifts]){const id=sample.actorId??sample.targetId;sample.end=snapshot(id);sample.events=events.slice(sample.eventStart);sample.censored=true;}
 assert.equal(game.winner,config.winner);assert.equal(turns,config.turns);
 matches.push({lineup:config.lineup,seed:config.seed,start:config.start,team:config.team,winner:game.winner,turns,acceptanceOutcomeIdentical:true});
}
const report={candidateCommit:reference.commit,sampling:'Fixed first seed82001/start0, all4 rosters/both colors; first high-hand action, first high-hand refinement, first gift per policy/hero/initiating-action-class in protocol order; no favorable selection',limits:['Actual interval losses are observed, not causal estimates of alternate actions','Gift recipient snapshots are evaluation-only actual state, never policy input','nextAction means next non-skipped own turn before its action, after begin-turn effects; same-turn extra actions remain in interval; ended games are censored', 'recipientAfter/donorAfter are immediate giveCards snapshots before later skill healing/overflow; use nextAction and events for the entire interval','Energy values are stock snapshots, not total gross expenditures; nested choices may spend between snapshots','High-hand samples start at action selection after begin-turn effects; aggregate telemetry counts at turn entry'],matches,samples,gifts,giftCounts};
await writeFile(new URL('bounded-high-hand-audit.json',root),JSON.stringify(report,null,2));
console.log(JSON.stringify({matches:matches.length,samples:samples.length,gifts:gifts.length,censoredSamples:samples.filter(s=>s.censored).length}));
