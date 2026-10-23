import {aiFor,aiForSkill,attackAmount} from './registry.js';
import {piercingOptions} from '../../../marksman/ai.js';
import {contractOption} from '../../../priest/ai.js';
import {isBinding} from '../../../sealer/ai.js';
export {piercingOptions,contractOption};
import {createDeck} from '../../../../cards.js';
import {clone,traits,value,difference,components,spend,remove,draw,damage,heal,payEnergy,stones,transfer,overflow} from './model.js';
const printed=createDeck();
const lightRate=printed.filter(c=>c.name==='holyLight').length/printed.length;
const special=(c,id)=>c.uniqueSkills.includes(id);
const enemy=(s,id)=>s.players.filter(p=>p.team!==s.players[id].team);
const terminal=s=>Object.values(s.teams).some(t=>t.morale<=0||t.cups>=5);
export const SEARCH_LIMIT=64;
const searchBudget=()=>({left:SEARCH_LIMIT,used:0});
export function giftOptions(s,id,targetId,cards=s.players[id].hand) {
 return cards.map(c=>{const next=clone(s);transfer(next,id,targetId,c);overflow(next,targetId);return {card:c.id,state:next,score:value(next)-value(s),parts:difference(s,next)};}).sort((a,b)=>b.score-a.score);
}
export function probability(s,id,c,targetId,{forced=false,storm=false}={}) {
 const target=s.players[targetId];if(forced)return {hit:1,light:0,counter:0};
 const shield=target.effects.some(e=>e.name==='holyShield')&&!storm;
 const gaps=s.beliefs[targetId]??{},elements=traits(c,id);
 const canCounter=c.name!=='darkStrike'&&!storm&&(aiFor(s.players[id]).canCounter?.(elements)??true);
 const counter=canCounter?printed.filter(x=>x.type==='attack'&&(x.name==='darkStrike'||x.elements.some(e=>elements.includes(e)))).length/printed.length*(1-Math.min(...elements.map(e=>gaps[e]??0))):0;
 const light=lightRate*(1-(gaps.light??0)),r=counter+light,hit=(1-r)**target.count;
 return {hit:shield?0:hit,shield:shield?hit:0,light:r?(1-hit)*light/r:0,counter:r?(1-hit)*counter/r:0};
}
function reflect(s,id,sourceId,amount) {
 // Engine excludes the previous attacker from counter targets. Estimate one
 // public teammate hit, never fabricate that teammate's response cards.
 s=clone(s);s.uncertain=true;
 const targets=s.players.filter(t=>t.team===s.players[id].team&&t.id!==id);
 const outcomes=targets.map(t=>{
  const chance=.75**t.count,hit=clone(s),response=clone(s);
  const shield=t.effects.some(e=>e.name==='holyShield');
  if(shield)hit.players[t.id].effects=hit.players[t.id].effects.filter(e=>e.name!=='holyShield');
  else {damage(hit,t.id,amount,'attack');stones(hit,s.players[sourceId].team,'crystal',1);}
  response.players[t.id].count=Math.max(0,t.count-1);
  return [{probability:chance,state:hit,path:[shield?'counter-shield':'counter-hit']},{probability:1-chance,state:response,path:['counter-answered']}];
 });
 return outcomes.sort((a,b)=>expected(a)-expected(b))[0]??[{probability:1,state:s,path:[]}];
}
export function attackBranches(input,id,c,targetId,{precision=null,active=true,count=0,sequence=true}={}) {
 const s=clone(input),p=s.players[id],beforeCount=p.count;spend(s,id,[c]);
 if(terminal(s))return [{probability:1,state:s,path:['exposure-terminal']}];
 const t=s.players[targetId],hook=aiFor(p),attack={card:c,target:t,active,count},storm=hook.storm?.(attack)??false;
 const usePrecision=precision===true;
 const forced=usePrecision||(hook.forcedHit?.(attack)??false);
 const probabilities=probability(s,id,c,targetId,{forced,storm});
 if(!forced&&(probabilities.light>0||probabilities.counter>0))s.uncertain=true;
 let amount=attackAmount(p)+(hook.attackBonus?.(attack)??0);
 if(usePrecision)amount--;
 const branches=[];
 if(probabilities.hit) {
  let hit=clone(s);damage(hit,targetId,amount,'attack');
  hit=hook.improveHit?.(s,id,targetId,amount,hit)??hit;
  stones(hit,p.team,active?'gem':'crystal',1);branches.push({probability:probabilities.hit,state:hit,path:[usePrecision?'precision-hit':'hit']});
 }
 for(const kind of ['light','counter','shield']) {
  const chance=kind==='shield'?(probabilities.shield??0):probabilities[kind];if(!chance)continue;
  let miss=clone(s);
  if(kind==='shield')miss.players[targetId].effects=miss.players[targetId].effects.filter(e=>e.name!=='holyShield');
  else miss.players[targetId].count=Math.max(0,miss.players[targetId].count-1);
  const path=[kind];
  if(sequence&&active&&!terminal(miss))miss=hook.afterMiss?.(miss,id,targetId,path)??miss;
  if(kind==='counter'&&!terminal(miss))for(const outcome of reflect(miss,id,targetId,attackAmount(miss.players[targetId])))branches.push({...outcome,probability:chance*outcome.probability,path:[...path,...outcome.path]});
  else branches.push({probability:chance,state:miss,path});
 }
 return branches.map(b=>({...b,steps:[{type:'attack',actorId:id,targetId,card:c.name,elements:traits(c,id),active,precision:usePrecision,result:b.path.join(' → ')}]}));
}
function evaluatedBranches(branches) {const branchParts=branches.map(b=>components(b.state));return {branchParts,total:branches.reduce((sum,b,i)=>sum+b.probability*Object.values(branchParts[i]).reduce((a,b)=>a+b,0),0)};}
export function expected(branches) {return branches.reduce((sum,b)=>sum+b.probability*value(b.state),0);}
export function magicBranches(s,sourceId,targetId,amount=2,participants=[sourceId,targetId],depth=1) {
 s=clone(s);s.uncertain=true;
 const t=s.players[targetId],rate=lightRate+printed.filter(c=>c.name==='magicBullet').length/printed.length;
 const hitChance=(1-rate)**t.count,hit=clone(s),answer=clone(s);
 if(t.effects.some(e=>e.name==='holyShield'))hit.players[targetId].effects=hit.players[targetId].effects.filter(e=>e.name!=='holyShield');else damage(hit,targetId,amount);
 answer.players[targetId].count=Math.max(0,t.count-1);
 const lightShare=lightRate/rate,branches=[{probability:hitChance,state:hit,path:['magic-hit-check']},{probability:(1-hitChance)*lightShare,state:answer,path:['magic-light']}];
 const next=Array.from({length:s.players.length},(_,i)=>s.players[(targetId+i+1)%s.players.length]).find(p=>p.team!==t.team&&!participants.includes(p.id));
 if(depth&&next)for(const b of magicBranches(answer,targetId,next.id,amount+1,[...participants,next.id],depth-1))branches.push({...b,probability:b.probability*(1-hitChance)*(1-lightShare),path:['magic-relay',...b.path]});
 else branches.push({probability:(1-hitChance)*(1-lightShare),state:answer,path:['magic-relay-horizon']});
 return branches.filter(b=>b.probability>0);
}
export function bestAttack(s,id,{count=0,depth=1,restriction=null,sequence=true,budget=searchBudget()}={}) {
 const baseTotal=value(s);
 let best={score:0,total:baseTotal,branches:[{probability:1,state:s,path:['pass']}],card:null,targetId:null};
 if(terminal(s)||depth<1)return best;
 const immediate=[];
 for(const c of s.players[id].hand.filter(c=>c.type==='attack'&&(!restriction||traits(c,id).includes(restriction)))) for(const t of enemy(s,id)) {
  if(!budget.left)break;
  const candidate=planAttack(s,id,c,t.id,{count,depth:1,sequence,budget,baseTotal});
  immediate.push({...candidate,card:c.id,targetId:t.id});
  if(candidate.score>best.score)best={...candidate,card:c.id,targetId:t.id};
 }
 // Two best immediate continuations receive deeper search. Immediate negative
 // candidates remain eligible: a costly second attack can enable the third.
 if(depth>1)for(const entry of immediate.sort((a,b)=>b.score-a.score).slice(0,2)) {
  if(!budget.left)break;
  const c=s.players[id].hand.find(c=>c.id===entry.card),candidate=planAttack(s,id,c,entry.targetId,{count,depth,sequence,budget,baseTotal});
  if(candidate.score>best.score)best={...candidate,card:c.id,targetId:entry.targetId};
 }
 return best;
}
export function planAttack(s,id,c,targetId,{count=0,depth=1,sequence=true,budget=searchBudget(),baseTotal=value(s)}={}) {
 budget.left--;budget.used++;
 let best=null;
 const precision=aiFor(s.players[id]).precisionOptions?.(c)??[false];
 for(const usePrecision of precision) {
  let branches=attackBranches(s,id,c,targetId,{precision:usePrecision,count,sequence});
  // Small two/three-action horizon. Every branch pays its cards and energy once.
  // Only a genuinely available extra action is searched; arbitrary next turns
  // and unknown draws are not converted into playable invented cards.
  branches=aiFor(s.players[id]).followAttacks?.(branches,id,c,{count,depth,sequence,budget})??branches;
  const evaluated=evaluatedBranches(branches),score=evaluated.total-baseTotal;if(!best||score>best.score)best={score,branches,...evaluated,precision:usePrecision};
 }
 return best;
}
function effect(s,id,name,c) {const p=s.players[id];if(name!=='poison')p.effects=p.effects.filter(e=>e.name!==name);p.effects.push({id:c?.id??name,name,card:c});}
export function removeEffectOptions(s,id,targets,{take=false}={}) {
 const result=[];for(const target of targets)for(const e of s.players[target].effects) {
  if(isBinding(e))continue;
  const next=clone(s);next.players[target].effects=next.players[target].effects.filter(x=>x.id!==e.id);
  if(take&&e.card){next.players[id].hand.push(e.card);next.players[id].count++;overflow(next,id);}
  result.push({id:e.id,state:aiFor(s.players[id]).afterEffectRemoval?.(next)??next});
 }
 return result.map(entry=>({entry,total:value(entry.state)})).sort((a,b)=>b.total-a.total).map(x=>x.entry);
}
export function actionPlan(s,id,action,{sequence=true,baseTotal=value(s),contracts=null}={}) {
 const activation=aiFor(s.players[id]).planActivation?.(s,id,action,{sequence,baseTotal,contracts,actionPlan});
 if(activation)return activation;
 const budget=searchBudget();
 const p=s.players[id],card=action.type==='play'?p.hand[action.index]:null;
 if(card?.type==='attack'){const plan=planAttack(s,id,card,action.targetId,{count:s.turn?.attackCount??0,depth:sequence?Math.max(1,3-(s.turn?.attackCount??0)):1,sequence,budget,baseTotal});return {...plan,search:{limit:SEARCH_LIMIT,used:budget.used}};}
 let next=clone(s),actor=next.players[id],target=action.targetId??action.targetIds?.[0],spell=false,magic=null;
 const costs=(action.cardIds??[]).map(cid=>p.hand.find(c=>c.id===cid));
 const skill=aiForSkill(action.skillId),selection=skill.effectSelection?.[action.skillId];
 const selectedEffect=selection?removeEffectOptions(s,id,[target],selection)[0]?.id:null;
 if(action.type==='pass')return {score:0,branches:[{probability:1,state:next,path:['pass']}]};
 if(card) {
  spend(next,id,[card]);spell=true;
  if(!terminal(next)) {
   if(['holyShield','weakness','poison'].includes(card.name)){effect(next,target,card.name,card);if(card.name==='holyShield')next=aiFor(p).afterShield?.(next)??next;}
   else if(card.name==='magicBullet')magic=magicBranches(next,id,target,2);
  }
 }else if(action.type==='skill') {
  spell=true;
  if(skill.energySkills?.includes(action.skillId))payEnergy(next,id);
  spend(next,id,costs,{publicExposure:!skill.hiddenCostSkills?.includes(action.skillId)});
  if(!terminal(next))next=skill.resolveAction?.(next,id,action,{target,costs,selectedEffect,effect})??next;
 }else if(action.type==='purchase'){draw(next,id,3);stones(next,p.team,'gem',1);stones(next,p.team,'crystal',1);}
 else if(action.type==='synthesize'){stones(next,p.team,'gem',-action.gemCount);stones(next,p.team,'crystal',-(3-action.gemCount));draw(next,id,3);next.teams[p.team].cups++;next.teams[p.team==='red'?'blue':'red'].morale--;}
 else if(action.type==='refine'){for(const kind of ['gem','crystal']){stones(next,p.team,kind,-action.stones[kind]);next.players[id].energy[kind]+=action.stones[kind];}}
 else if(action.type==='refresh'){next.players[id].hand=[];next.players[id].count=0;draw(next,id,Math.min(4,p.limit));}
 if(['purchase','synthesize','refine'].includes(action.type))aiFor(p).afterSpecial?.(next,id);
 let branches=magic??[{probability:1,state:next,path:[action.skillId??card?.name??action.type]}];
 branches=branches.map(b=>({...b,steps:[{type:action.type,actorId:id,targetId:target,card:card?.name,skillId:action.skillId,result:b.path.join(' → '),gifts:b.state.players.flatMap(t=>t.known.filter(c=>!s.players[t.id].known.some(x=>x.id===c.id)).map(c=>({targetId:t.id,card:c.name})))}]}));
 const primaryBranches=branches;
 if(sequence&&!terminal(next)&&((aiFor(p).followsSpell?.(spell,action)??false)||(skill.followsSpell?.(false,action)??false))) {
  branches=branches.flatMap(branch=>{const follow=bestAttack(branch.state,id,{depth:1,sequence,budget});return follow.score>0?follow.branches.map(b=>({...b,probability:b.probability*branch.probability,path:[...branch.path,...b.path],steps:[...branch.steps,...(b.steps??[])]})):[branch];});
 }
 const evaluated=evaluatedBranches(branches);
 return {score:evaluated.total-baseTotal,branches,...evaluated,primaryBranches,search:{limit:SEARCH_LIMIT,used:budget.used}};
}
export function explain(s,plan,base=components(s)) {
 const parts=Object.fromEntries(Object.keys(base).map(k=>[k,0]));
 for(const [i,b] of plan.branches.entries())for(const [k,v] of Object.entries((()=>{const after=plan.branchParts?.[i]??components(b.state);return Object.fromEntries(Object.keys(base).map(k=>[k,after[k]-base[k]]));})()))parts[k]+=b.probability*v;
 return {parts,branches:plan.branches.map(b=>({probability:b.probability,path:b.path,steps:b.steps??[]})),primaryParts:plan.primaryBranches===plan.branches?parts:plan.primaryBranches?explain(s,{branches:plan.primaryBranches},base).parts:null,precision:plan.precision??null,search:plan.search??null};
}
