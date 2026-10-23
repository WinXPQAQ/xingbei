import {chooseAiRuleDecision as fallbackDecision} from './decisions.js';
import {planWindAttacks} from '../../../wind-swordmaster/ai-wind-plan.js';
import {aiFor,aiForSkill,attackAmount} from './registry.js';
import {bindingDrawAmount} from '../../../sealer/ai.js';
export {planWindAttacks};
import {captureObservation,observationView,isolatePolicy} from '../../../../ai/observation.js';
import {stateOf,clone,value,cardData,spend,remove,draw,damage,heal,payEnergy,transfer,overflow,components,synthesisHealing} from './model.js';
import {actionPlan,contractOption,explain,piercingOptions,giftOptions,bestAttack,attackBranches,magicBranches,expected,removeEffectOptions} from './planner.js';
import {requestData,requestFromData} from './trace.js';

const combinations=(items,n)=>n===0?[[]]:items.flatMap((item,i)=>combinations(items.slice(i+1),n-1).map(rest=>[item,...rest]));
export function enumerate(g,id) {
 if(g.canRefreshUnableHand(id))return [{type:'refresh'}];
 const p=g.player(id),actions=[{type:'pass'}];
 for(const {index,targets} of g.legalCards(id))for(const targetId of targets)actions.push({type:'play',index,targetId});
 for(const entry of g.legalSkillActions(id))for(const mode of entry.spec.modes?.map(m=>m.value)??[undefined]) {
  const spec=g.skillActionSpec(id,{skillId:entry.skillId,mode});
  for(const costs of combinations(p.hand.filter(spec.cardFilter??(()=>true)),spec.cardCount??0))for(const count of spec.targetCounts??[spec.targetCount??1])for(const targets of combinations(spec.targets,count))actions.push({type:'skill',skillId:entry.skillId,mode,cardIds:costs.map(c=>c.id),targetIds:targets});
 }
 const stones=g.stoneCounts(p.team);
 if(g.canDrawSpecial(id)){actions.push({type:'purchase'});if(stones.total>=3){const spec=g.synthesisOptions(p.team);for(const gemCount of spec.automatic?[spec.gemCount]:spec.choices)actions.push({type:'synthesize',gemCount});}}
 if(g.canRefine(id))for(let gem=0;gem<=Math.min(2,stones.gem);gem++)for(let crystal=0;crystal<=Math.min(2,stones.crystal);crystal++)if(gem+crystal>=1&&gem+crystal<=2&&gem+crystal+p.energy.gem+p.energy.crystal<=3)actions.push({type:'refine',stones:{gem,crystal}});
 return actions;
}
export function createEconomyPolicy({sequence=true,economy=true,ownership=true,energy=true,healing=true,reuseBase=true}={}) {
 const disabled=Object.entries({ownership,energy,healing}).filter(([,v])=>!v).map(([k])=>k);
 const version='experimental/plans-4'+(disabled.length?'-no-'+disabled.join('-'):'');
 const state=(g,id)=>stateOf(g,id,{economy,ownership,energy,healing});
 const raw={planWindAttacks,
  rankAiActions(g,id) {const s=state(g,id),base=reuseBase?components(s):undefined,baseTotal=base?Object.values(base).reduce((a,b)=>a+b,0):value(s),contracts=new Map();return enumerate(g,id).map(action=>{const plan=actionPlan(s,id,action,{sequence,baseTotal,contracts});return {action,score:plan.score,reason:'expected-state-difference',explanation:explain(s,plan,base)};}).sort((a,b)=>b.score-a.score);},
  chooseAiDiscard(g,id,count,valid=null) {
   const s=state(g,id),hand=g.player(id).hand,allowed=valid??hand.map((_,i)=>i);let best=null;
   for(const indexes of combinations(allowed,count)){const next=clone(s);remove(next,id,indexes.map(i=>s.players[id].hand[i]));const score=value(next);if(!best||score>best.score)best={indexes,score};}
   return best?.indexes??[];
  },
  keepCards(g,id,cards,count) {const hand=g.player(id).hand,allowed=cards.map(c=>hand.findIndex(x=>x.id===c.id));const drop=new Set(this.chooseAiDiscard(g,id,cards.length-count,allowed));return cards.filter(c=>!drop.has(hand.findIndex(x=>x.id===c.id)));},
  cardScore(g,id,c) {const s=state(g,id),next=clone(s);remove(next,id,[c]);return value(s)-value(next);},
  giftScore(g,id,target,c) {return giftOptions(state(g,id),id,target,[c])[0].score;},
  chooseAiResponse(g,r) {
   const id=r.target.id,s=state(g,id),attacker=r.actor,amount=r.damage??r.context?.amount??(attacker?attackAmount({hero:attacker.hero.id,count:attacker.hand.length}):2);
   const take=clone(s);if(r.shieldable!==false&&take.players[id].effects.some(e=>e.name==='holyShield'))take.players[id].effects=take.players[id].effects.filter(e=>e.name!=='holyShield');else damage(take,id,amount,r.attack?.type==='attack'?'attack':'spell');
   let best={value:null,score:value(take)};
   for(const entry of r.valid??[]) {
    const c=s.players[id].hand[entry.index];if(!c)continue;
    if(c.type==='attack')for(const t of r.counterTargets??[]) {
     const options=aiFor(s.players[id]).precisionOptions?.(c)??[false];
     for(const precision of options){const score=expected(attackBranches(s,id,c,t.id,{active:false,precision,sequence:false}));if(score>best.score)best={value:{index:entry.index,targetId:t.id},score};}
    }else {
     const next=clone(s);spend(next,id,[c]);
     const score=c.name==='magicBullet'&&r.nextTarget?expected(magicBranches(next,id,r.nextTarget.id,(r.damage??2)+1)):value(next);if(score>best.score)best={value:{index:entry.index,targetId:r.nextTarget?.id??null},score};
    }
   }
   return best.value;
  },
  chooseAiRuleDecision(r,g) {
   if(!g)return r.defaultValue??null;
   const id=r.playerId??r.player?.id,s=state(g,id),p=s.players[id],context=r.context??{};
   const skill=aiForSkill(r.skillId),decision=skill.decide?.({request:r,game:g,state:s,id,player:p,context,sequence});
   if(decision!==undefined)return decision;
   if(r.type==='cardChoice') {
    if(r.purpose==='give') {
     let best=null;for(const indexes of combinations(r.valid,r.count)){const next=clone(s);for(const i of indexes)transfer(next,id,r.recipientId,p.hand[i]);
      skill.afterGift?.(next,id,r.recipientId,r.skillId);overflow(next,r.recipientId);
      const score=value(next);if(!best||score>best.score)best={indexes,score};}return best?.indexes??[];
    }
    return this.chooseAiDiscard(g,id,r.count,r.valid);
   }
   if(r.type==='healing') {
    const preserve=synthesisHealing(s,id,context.amount??0);
    if(preserve!==null&&r.choices.some(c=>c.value===preserve))return preserve;
    let best=null;for(const choice of r.choices){const next=clone(s);next.players[id].healing-=choice.value;draw(next,id,Math.max(0,(context.amount??0)-choice.value),{spell:context.damageType==='spell'});const score=value(next);if(!best||score>best.score)best={value:choice.value,score};}return best?.value??0;
   }
   if(r.type==='weakness'||r.type==='bindingChoice') {
    const amount=r.type==='weakness'?3:bindingDrawAmount(s,p);
    const next=clone(s);draw(next,id,amount);
    // The action retained by drawing has a conservative option estimate. Unknown
    // drawn cards remain unknown; they are never fed into a concrete sequence.
    return value(next)+Math.max(0,bestAttack(next,id,{sequence,depth:1}).score)>value(s)?'draw':'skip';
   }
   if(r.type==='effectChoice')return removeEffectOptions(s,id,[...new Set(r.choices.map(c=>g.cards.get(c.value)?.location.playerId).filter(x=>x!=null))],{take:skill.effectSelection?.[r.skillId]?.take??false}).find(e=>r.choices.some(c=>c.value===e.id))?.id??r.defaultValue;
   // Less common mandatory hero choices retain their existing legal decision
   // helpers, including the engine's reservedEnergy/reservedHealing contract.
   return fallbackDecision(r,g);
  },
 };
 const policy=isolatePolicy(raw,{activation:true});
 return {...policy,
  traceDecision(g,id,request=null) {
   const observation=captureObservation(g,id,{actions:!request,activation:true}),v=observationView(observation);
   if(request&&(request.playerId??request.player?.id??request.target?.id)!==id)throw Error('Trace observer must own the decision');
   if(!request)return {version,configuration:{sequence,economy,ownership,energy,healing},observation,candidates:raw.rankAiActions(v,id)};
   const type=request.type,decision=type==='overflow'?raw.chooseAiDiscard(v,id,v.player(id).hand.length-v.player(id).handLimit):type==='response'?policy.chooseAiResponse(g,request):policy.chooseAiRuleDecision(request,g);
   const trace={version,configuration:{sequence,economy,ownership,energy,healing},observation,request:requestData(request,v),type,skillId:request.skillId??null,decision};
   if(type==='cardChoice'&&request.skillId==='piercingShot')trace.candidates=piercingOptions(state(v,id),id,request.context.targetId,request.valid.map(i=>v.player(id).hand[i].id)).map(({card,score,parts})=>({card,score,parts}));
   return trace;
  },
  replayTrace(trace) {
   if(trace.version!==version)throw Error('Trace policy mismatch');
   const v=observationView(trace.observation),id=trace.observation.observerId;
   if(!trace.request)return raw.rankAiActions(v,id);
   const r=requestFromData(trace.request,v);
   return r.type==='overflow'?raw.chooseAiDiscard(v,id,v.player(id).hand.length-v.player(id).handLimit):r.type==='response'?raw.chooseAiResponse(v,r):raw.chooseAiRuleDecision(r,v);
  },
 };
}
