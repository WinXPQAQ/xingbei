// Diagnostic metadata only. Verify against frozen planner before rendering.
import {createDeck} from '../../../src/cards.js';
import {clone,traits,value,difference,components,spend,remove,draw,damage,heal,payEnergy,stones,transfer,overflow} from '../../../src/ai/targeted-fixes1/model.js';
const printed=createDeck();
const lightRate=printed.filter(c=>c.name==='holyLight').length/printed.length;
const special=(c,id)=>c.uniqueSkills.includes(id);
const enemy=(s,id)=>s.players.filter(p=>p.team!==s.players[id].team);
const terminal=s=>Object.values(s.teams).some(t=>t.morale<=0||t.cups>=5);
export const SEARCH_LIMIT=128;
const searchBudget=()=>({left:SEARCH_LIMIT,used:0});
export function piercingOptions(s,id,targetId,allowed=null) {
 const result=[{card:null,state:clone(s),score:0,parts:difference(s,s)}];
 for(const c of s.players[id].hand.filter(c=>c.type==='spell'&&(!allowed||allowed.includes(c.id)))) {
  const next=clone(s);spend(next,id,[c]);if(!terminal(next))damage(next,targetId,2);
  result.push({card:c.id,state:next,score:value(next)-value(s),parts:difference(s,next)});
 }
 return result.sort((a,b)=>b.score-a.score);
}
export function giftOptions(s,id,targetId,cards=s.players[id].hand) {
 return cards.map(c=>{const next=clone(s);transfer(next,id,targetId,c);overflow(next,targetId);return {card:c.id,state:next,score:value(next)-value(s),parts:difference(s,next)};}).sort((a,b)=>b.score-a.score);
}
export function probability(s,id,c,targetId,{forced=false,storm=false}={}) {
 const target=s.players[targetId];if(forced)return {hit:1,light:0,counter:0};
 if(target.effects.some(e=>e.name==='holyShield')&&!storm)return {hit:0,light:0,counter:0,shield:true};
 const gaps=s.beliefs[targetId]??{},elements=traits(c,id);
 const canCounter=c.name!=='darkStrike'&&!storm&&!(s.players[id].hero==='marksman'&&elements.includes('thunder'));
 const counter=canCounter?printed.filter(x=>x.type==='attack'&&(x.name==='darkStrike'||x.elements.some(e=>elements.includes(e)))).length/printed.length*(1-Math.min(...elements.map(e=>gaps[e]??0))):0;
 const light=lightRate*(1-(gaps.light??0)),r=counter+light,hit=(1-r)**target.count;
 return {hit,light:r?(1-hit)*light/r:0,counter:r?(1-hit)*counter/r:0};
}
function reflect(s,id,sourceId,amount) {
 // Engine excludes the previous attacker from counter targets. Estimate one
 // public teammate hit, never fabricate that teammate's response cards.
 const targets=s.players.filter(t=>t.team===s.players[id].team&&t.id!==id);
 const outcomes=targets.map(t=>{
  if(t.effects.some(e=>e.name==='holyShield')){const next=clone(s);next.players[t.id].effects=next.players[t.id].effects.filter(e=>e.name!=='holyShield');return [{probability:1,state:next,path:['counter-shield']}];}
  const chance=.75**t.count,hit=clone(s),response=clone(s);
  damage(hit,t.id,amount,'attack');stones(hit,s.players[sourceId].team,'crystal',1);
  response.players[t.id].count=Math.max(0,t.count-1);
  return [{probability:chance,state:hit,path:['counter-hit']},{probability:1-chance,state:response,path:['counter-answered']}];
 });
 return outcomes.sort((a,b)=>expected(a)-expected(b))[0]??[{probability:1,state:s,path:[]}];
}
export function attackBranches(input,id,c,targetId,{precision=null,active=true,count=0,sequence=true}={}) {
 const s=clone(input),p=s.players[id],beforeCount=p.count;spend(s,id,[c]);
 if(terminal(s))return [{probability:1,state:s,path:['exposure-terminal']}];
 const t=s.players[targetId],storm=p.hero==='windSwordmaster'&&special(c,'stormArt')&&t.effects.some(e=>e.name==='holyShield');
 const usePrecision=precision===true;
 const forced=usePrecision||(active&&p.hero==='windSwordmaster'&&count===2)||(active&&p.hero==='berserker'&&special(c,'bloodyRoar')&&t.healing===2);
 const probabilities=probability(s,id,c,targetId,{forced,storm});
 let amount=p.hero==='berserker'?3+Number(p.count>3):2;
 if(active&&p.hero==='berserker'&&special(c,'bloodBlade'))amount+=t.count===2?2:t.count===3?1:0;
 if(usePrecision)amount--;
 const branches=[];
 if(probabilities.hit) {
  let hit=clone(s);damage(hit,targetId,amount,'attack');
  if(p.hero==='berserker'&&p.energy.gem>0) {
   const rend=clone(s);payEnergy(rend,id,1,'gem');damage(rend,targetId,amount+2,'attack');if(value(rend)>value(hit))hit=rend;
  }
  stones(hit,p.team,active?'gem':'crystal',1);branches.push({probability:probabilities.hit,state:hit,path:[usePrecision?'precision-hit':'hit']});
 }
 for(const kind of ['light','counter','shield']) {
  const chance=kind==='shield'?Number(probabilities.shield):probabilities[kind];if(!chance)continue;
  let miss=clone(s);
  if(kind==='shield')miss.players[targetId].effects=miss.players[targetId].effects.filter(e=>e.name!=='holyShield');
  else miss.players[targetId].count=Math.max(0,miss.players[targetId].count-1);
  const path=[kind];
  if(sequence&&active&&p.hero==='marksman'&&!terminal(miss)) {
   const best=piercingOptions(miss,id,targetId)[0];miss=best.state;if(best.card)path.push(`piercing:${best.card}`);
  }
  if(kind==='counter'&&!terminal(miss))for(const outcome of reflect(miss,id,targetId,s.players[targetId].hero==='berserker'?3+Number(miss.players[targetId].count>3):2))branches.push({...outcome,probability:chance*outcome.probability,path:[...path,...outcome.path]});
  else branches.push({probability:chance,state:miss,path});
 }
 return branches.map(b=>({...b,steps:[{cardId:c.id,actorId:id,targetId,active,precision:usePrecision}]}));
}
export function expected(branches) {return branches.reduce((sum,b)=>sum+b.probability*value(b.state),0);}
export function magicBranches(s,sourceId,targetId,amount=2,participants=[sourceId,targetId],depth=1) {
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
 let best={score:0,branches:[{probability:1,state:s,path:['pass']}],card:null,targetId:null};
 if(terminal(s)||depth<1)return best;
 const immediate=[];
 for(const c of s.players[id].hand.filter(c=>c.type==='attack'&&(!restriction||traits(c,id).includes(restriction)))) for(const t of enemy(s,id)) {
  if(!budget.left)break;
  const candidate=planAttack(s,id,c,t.id,{count,depth:1,sequence,budget});
  immediate.push({...candidate,card:c.id,targetId:t.id});
  if(candidate.score>best.score)best={...candidate,card:c.id,targetId:t.id};
 }
 // Two best immediate continuations receive deeper search. Immediate negative
 // candidates remain eligible: a costly second attack can enable the third.
 if(depth>1)for(const entry of immediate.sort((a,b)=>b.score-a.score).slice(0,2)) {
  if(!budget.left)break;
  const c=s.players[id].hand.find(c=>c.id===entry.card),candidate=planAttack(s,id,c,entry.targetId,{count,depth,sequence,budget});
  if(candidate.score>best.score)best={...candidate,card:c.id,targetId:entry.targetId};
 }
 return best;
}
export function planAttack(s,id,c,targetId,{count=0,depth=1,sequence=true,budget=searchBudget()}={}) {
 budget.left--;budget.used++;
 let best=null;
 const precision=s.players[id].hero==='marksman'&&special(c,'precisionShot')?[false,true]:[false];
 for(const usePrecision of precision) {
  let branches=attackBranches(s,id,c,targetId,{precision:usePrecision,count,sequence});
  const primaryBranches=branches;
  // Small two/three-action horizon. Every branch pays its cards and energy once.
  // Only a genuinely available extra action is searched; arbitrary next turns
  // and unknown draws are not converted into playable invented cards.
  if(sequence&&depth>1&&s.players[id].hero==='windSwordmaster'&&count<2) {
   branches=branches.flatMap(b=>{
    const p=b.state.players[id],choices=[{restriction:null,cost:0,skill:special(c,'galeArt')?'galeArt':null}];
    if(!b.state.turn?.usedSkills?.windFury)choices.push({restriction:'wind',cost:0,skill:'windFury'});
    if(!b.state.turn?.usedSkills?.swordShadow&&p.energy.gem+p.energy.crystal)choices.push({restriction:null,cost:1,skill:'swordShadow'});
    let follow={branches:[{probability:1,state:b.state,path:[]}],score:0};
    for(const option of choices.filter(o=>o.skill)) {
     const next=clone(b.state);if(option.cost)payEnergy(next,id);
     next.turn??={usedSkills:{}};next.turn.usedSkills??={};next.turn.usedSkills[option.skill]=true;
     const found=bestAttack(next,id,{count:count+1,depth:depth-1,restriction:option.restriction,sequence,budget});
     const gain=expected(found.branches)-value(b.state);if(gain>follow.score)follow={...found,score:gain};
    }
    return follow.branches.map(f=>({probability:b.probability*f.probability,state:f.state,path:[...b.path,...f.path],steps:[...(b.steps??[]),...(f.steps??[])]}));
   });
  }
  const score=expected(branches)-value(s);if(!best||score>best.score)best={score,branches,primaryBranches,precision:usePrecision};
 }
 return best;
}
function effect(s,id,name,c) {const p=s.players[id];if(name!=='poison')p.effects=p.effects.filter(e=>e.name!==name);p.effects.push({id:c?.id??name,name,card:c});}
export function removeEffectOptions(s,id,targets,{take=false}={}) {
 const result=[];for(const target of targets)for(const e of s.players[target].effects) {
  if(e.name==='fivefoldBinding')continue;
  const next=clone(s);next.players[target].effects=next.players[target].effects.filter(x=>x.id!==e.id);
  if(take&&e.card){next.players[id].hand.push(e.card);next.players[id].count++;overflow(next,id);}
  if(s.players[id].hero==='guardianAngel') {
   let best=next;for(const t of next.players){const healed=clone(next);heal(healed,t.id,1);if(value(healed)>value(best))best=healed;}result.push({id:e.id,state:best});
  }else result.push({id:e.id,state:next});
 }
 return result.sort((a,b)=>value(b.state)-value(a.state));
}
export function actionPlan(s,id,action,{sequence=true}={}) {
 const budget=searchBudget();
 const p=s.players[id],card=action.type==='play'?p.hand[action.index]:null;
 if(card?.type==='attack'){const plan=planAttack(s,id,card,action.targetId,{count:s.turn?.attackCount??0,depth:sequence?Math.max(1,3-(s.turn?.attackCount??0)):1,sequence,budget});return {...plan,search:{limit:SEARCH_LIMIT,used:budget.used}};}
 let next=clone(s),actor=next.players[id],target=action.targetId??action.targetIds?.[0],spell=false,magic=null;
 const costs=(action.cardIds??[]).map(cid=>p.hand.find(c=>c.id===cid));
 if(action.type==='pass')return {score:0,branches:[{probability:1,state:next,path:['pass']}]};
 if(card) {
  spend(next,id,[card]);spell=true;
  if(!terminal(next)) {
   if(['holyShield','weakness','poison'].includes(card.name))effect(next,target,card.name,card);
   else if(card.name==='magicBullet')magic=magicBranches(next,id,target,2);
  }
 }else if(action.type==='skill') {
  spell=true;
  if(['snipe','fivefoldBinding','sealBreaking','sacredDomain'].includes(action.skillId))payEnergy(next,id);
  spend(next,id,costs,{publicExposure:action.skillId!=='sacredDomain'});
  if(!terminal(next))switch(action.skillId) {
   case 'waterPower': {
    // Mandatory gift after paying water. Choose the completed effect, including
    // healing before overflow, instead of optimizing a separate card heuristic.
    const candidates=actor.hand.map(c=>{const t=clone(next);transfer(t,id,target,c);heal(t,id,1);heal(t,target,1);overflow(t,target);return t;});
    if(actor.count>actor.hand.length){const t=clone(next);t.players[id].count--;t.players[target].count++;heal(t,id,1);heal(t,target,1);overflow(t,target);candidates.push(t);}
    if(!actor.count){heal(next,id,1);heal(next,target,1);candidates.push(next);}
    next=candidates.sort((a,b)=>value(b)-value(a))[0];break;
   }
   case 'prayer':heal(next,id,2);break;
   case 'sacredDomain':if(action.mode==='damage'){next.players[id].healing--;damage(next,target,2);}else{heal(next,id,2);heal(next,target,1);}break;
   case 'flashTrap':damage(next,target,2);break;
   case 'snipe':draw(next,target,Math.max(0,5-next.players[target].count));break;
   case 'angelWall':effect(next,target,'holyShield',costs[0]);heal(next,target,1);break;
   case 'windCleansing':case 'sealBreaking':next=removeEffectOptions(next,id,[target],{take:action.skillId==='sealBreaking'})[0]?.state??next;break;
   case 'angelBlessing':for(const t of action.targetIds){const n=Math.min(next.players[t].count,action.targetIds.length===1?2:1);next.players[t].count-=n;next.players[id].count+=n;}overflow(next,id);break;
   default:if(action.skillId.endsWith('Seal')||action.skillId==='fivefoldBinding')effect(next,target,action.skillId,costs[0]);
  }
 }else if(action.type==='purchase'){draw(next,id,3);stones(next,p.team,'gem',1);stones(next,p.team,'crystal',1);}
 else if(action.type==='synthesize'){stones(next,p.team,'gem',-action.gemCount);stones(next,p.team,'crystal',-(3-action.gemCount));draw(next,id,3);next.teams[p.team].cups++;next.teams[p.team==='red'?'blue':'red'].morale--;}
 else if(action.type==='refine'){for(const kind of ['gem','crystal']){stones(next,p.team,kind,-action.stones[kind]);next.players[id].energy[kind]+=action.stones[kind];}}
 else if(action.type==='refresh'){next.players[id].hand=[];next.players[id].count=0;draw(next,id,Math.min(4,p.limit));}
 if(['purchase','synthesize','refine'].includes(action.type)&&p.hero==='priest')heal(next,id,1);
 let branches=magic??[{probability:1,state:next,path:[action.skillId??card?.name??action.type]}];
 const primaryBranches=branches;
 if(sequence&&!terminal(next)&&((spell&&p.hero==='sealer')||action.skillId==='snipe')) {
  branches=branches.flatMap(branch=>{const follow=bestAttack(branch.state,id,{depth:1,sequence,budget});return follow.score>0?follow.branches.map(b=>({...b,probability:b.probability*branch.probability,path:[...branch.path,...b.path]})):[branch];});
 }
 return {score:expected(branches)-value(s),branches,primaryBranches,search:{limit:SEARCH_LIMIT,used:budget.used}};
}
export function explain(s,plan,base=components(s)) {
 const parts=Object.fromEntries(Object.keys(base).map(k=>[k,0]));
 for(const b of plan.branches)for(const [k,v] of Object.entries((()=>{const after=components(b.state);return Object.fromEntries(Object.keys(base).map(k=>[k,after[k]-base[k]]));})()))parts[k]+=b.probability*v;
 const primaryParts=Object.fromEntries(Object.keys(parts).map(k=>[k,0]));
 for(const b of plan.primaryBranches??plan.branches)for(const [k,v]of Object.entries(difference(s,b.state)))primaryParts[k]+=b.probability*v;
 const continuationParts=Object.fromEntries(Object.keys(parts).map(k=>[k,parts[k]-primaryParts[k]]));
 return {parts,primaryParts,continuationParts,branches:plan.branches.map(b=>({probability:b.probability,path:b.path})),precision:plan.precision??null,search:plan.search??null};
}
