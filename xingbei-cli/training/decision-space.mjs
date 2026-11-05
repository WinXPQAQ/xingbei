// Read-only, lazy choices. A leaf is the sole command committed to the engine.
// In particular, no selected discard card leaves the hand before the last leaf.
import { targetCounts } from '../src/card-sets.js';
import { playableCards } from '../src/playable-cards.js';
import { Timing } from '../src/timing.js';

const leaf = value => ({ done: true, value });
const key = value => JSON.stringify(value);
const unique = values => [...new Set(values)];
const contains = (set, prefix) => prefix.every(value => set.includes(value));
const sameSet = (a,b) => a.length===b.length && contains(a,b);

function node(request, stage, candidates, next, teacher, summaries = [], prefix) {
  if (!candidates.length) throw new Error(`Empty conditional decision: ${stage}`);
  return { done:false, request:{...request,stage,...(prefix===undefined?{}:{prefix})}, candidates, summaries,
    next(value) {
      const index=candidates.findIndex(candidate=>key(candidate)===key(value));
      if(index<0)throw new Error(`Invalid conditional choice: ${stage}`);
      return next(candidates[index],index);
    },
    teacherIndex(command) {
      const index=teacher(command);
      if(!Number.isInteger(index)||index<0||index>=candidates.length)throw new Error(`Teacher cannot complete conditional choice: ${stage}`);
      return index;
    },
  };
}

// The existence search short-circuits. It never materializes C(n,k) arrays.
function completion(available, count, selected, predicate = () => true) {
  if(selected.length>count || !contains(available,selected))return false;
  const rest=available.filter(value=>!selected.includes(value)), missing=count-selected.length;
  if(rest.length<missing)return false;
  const visit=(offset,chosen)=>{
    if(chosen.length===missing)return predicate([...selected,...chosen]);
    for(let i=offset;i<=rest.length-(missing-chosen.length);i++)if(visit(i+1,[...chosen,rest[i]]))return true;
    return false;
  };
  return visit(0,[]);
}

function setSelection({request,available,counts,validSets,optional=false,selected=[],wrap=x=>x,finish=x=>leaf(x),teacherSet=x=>x,stage='selectCards',prefix=selected,summaries}) {
  const canFinish = values => validSets ? validSets.some(set=>sameSet(set,values)) : counts.includes(values.length);
  const canComplete = values => validSets ? validSets.some(set=>contains(set,values))
    : counts.some(count=>count>=values.length&&count<=available.length);
  const extend=available.filter(value=>!selected.includes(value)&&canComplete([...selected,value]));
  const remainingCounts=unique(validSets?validSets.filter(set=>contains(set,selected)).map(set=>set.length-selected.length)
    :counts.filter(count=>count>=selected.length&&count<=available.length).map(count=>count-selected.length));
  if(canFinish(selected)&&!extend.length&&!(optional&&!selected.length))return finish([...selected].sort((a,b)=>a-b));
  const candidates=[...(optional&&!selected.length?[null]:[]),...(canFinish(selected)?[wrap([])]:[]),...extend.map(value=>wrap([value]))];
  const stepRequest={...request,count:counts.length===1?counts[0]:null,remainingCount:remainingCounts.length===1?remainingCounts[0]:null,
    remainingCounts,remainingMin:remainingCounts.length?Math.min(...remainingCounts):null,remainingMax:remainingCounts.length?Math.max(...remainingCounts):null,selectedIndices:[...selected]};
  return node(stepRequest,stage,candidates,value=>{
    if(value===null)return leaf(null);
    const index=candidates.indexOf(value), skip=optional&&!selected.length?1:0;
    if(canFinish(selected)&&index===skip)return finish([...selected].sort((a,b)=>a-b));
    const picked=extend[index-skip-(canFinish(selected)?1:0)];
    return setSelection({request,available,counts,validSets,optional,selected:[...selected,picked],wrap,finish,teacherSet,stage,
      prefix:Array.isArray(prefix)?[...selected,picked]:prefix,summaries});
  },command=>{
    const values=teacherSet(command);
    if(values===null)return candidates.indexOf(null);
    if(!Array.isArray(values)||!contains(values,selected))return -1;
    if(sameSet(values,selected))return candidates.findIndex(value=>value!==null&&key(value)===key(wrap([])));
    const chosen=extend.find(value=>values.includes(value));
    return chosen===undefined?-1:candidates.findIndex(value=>key(value)===key(wrap([chosen])));
  },candidates.map(()=>summaries??{}),prefix);
}

function skillSpec(game,id,entry,mode) {
  const raw=game.skillActionSpec(id,{skillId:entry.skillId,...(mode===undefined?{}:{mode})});
  if(!raw)return null;
  const spec={...raw,targets:raw.targets??[]};
  const hand=game.player(id).hand, available=hand.filter(spec.cardFilter??(()=>true));
  const validCounts=(spec.cardCounts??[spec.cardCount??0]).filter(count=>targetCounts(spec,count).some(n=>n>=0&&n<=(spec.targets??[]).length));
  const predicate=cards=>(spec.cardsFilter?.(cards)??true);
  const feasible=selected=>validCounts.some(count=>completion(available,count,selected,predicate));
  return feasible([])?{spec,available,validCounts,predicate,feasible}:null;
}

export function buildDecisionSpace(game, playerId, request) {
  if(request.type==='overflow'||request.type==='cardChoice') {
    const player=game.player(playerId), overflow=request.type==='overflow';
    const available=overflow?player.hand.map((_,index)=>index):[...request.valid];
    const count=overflow?Math.max(0,player.hand.length-player.handLimit):request.count;
    return setSelection({request,available,counts:request.validSets?unique(request.validSets.map(set=>set.length)):[count],
      validSets:request.validSets,optional:!!request.optional});
  }
  if(request.type!=='action')return null;
  if(game.winner)return leaf(null);
  const state=game.turn.state;
  if(!state||state.playerId!==playerId||!game.turn.needsAction())throw new Error('Action requested outside active action phase');
  const player=game.player(playerId), normal=state.activationDone||state.completed;
  // Public subscriptions describe potential preparation, not proof that a
  // contextual filter will accept after earlier activation effects resolve.
  const activationSkillIds=()=>unique((game.triggers?.get(Timing.ACTIVATION,state)??[])
    .filter(entry=>entry.player.id===playerId).map(entry=>entry.definition.id));
  const cardEntries=normal?game.legalCards(playerId):[];
  const modeCache=new Map();
  const skillModes=entry=>{
    if(!modeCache.has(entry.skillId))modeCache.set(entry.skillId,(entry.spec.modes?.map(mode=>mode.value)??[undefined]).flatMap(mode=>{
      const detail=skillSpec(game,playerId,entry,mode);return detail?[{mode,...detail}]:[];
    }));
    return modeCache.get(entry.skillId);
  };
  const skills=game.legalSkillActions(playerId).filter(entry=>(normal||entry.spec.type==='special')&&skillModes(entry).length);
  const cardSummary=entries=>({cardIds:unique(entries.map(entry=>entry.card.id)),targetIds:unique(entries.flatMap(entry=>entry.targets))});
  const skillSummary=entries=>({skillIds:entries.map(entry=>entry.skillId),
    cardIds:unique(entries.flatMap(entry=>skillModes(entry).flatMap(detail=>detail.available.map(card=>card.id)))),
    targetIds:unique(entries.flatMap(entry=>skillModes(entry).flatMap(detail=>detail.spec.targets)))});
  function targets(command,spec,costCount,selected=[],required=null) {
    const counts=unique(targetCounts(spec,costCount).filter(n=>n<=spec.targets.length));
    if(required===null){
      if(counts.length===1)return targets(command,spec,costCount,selected,counts[0]);
      const choices=counts.map(targetCount=>({...command,targetCount}));
      return node(request,'targetCount',choices,value=>targets(command,spec,costCount,[],value.targetCount),
        teacher=>choices.findIndex(value=>value.targetCount===teacher.targetIds.length),[],command);
    }
    if(selected.length===required)return leaf({...command,targetIds:selected});
    const choices=spec.targets.filter(id=>!selected.includes(id)).map(id=>({...command,targetIds:[...selected,id]}));
    return node({...request,count:required,remainingCount:required-selected.length},'targets',choices,value=>targets(command,spec,costCount,value.targetIds,required),
      teacher=>choices.findIndex(value=>value.targetIds.every((id,index)=>id===teacher.targetIds[index])),[],{...command,targetCount:required,targetIds:selected});
  }
  function costs(command,detail,selected=[]) {
    const {available,validCounts,predicate,feasible,spec}=detail;
    const done=validCounts.includes(selected.length)&&predicate(selected);
    const extend=available.filter(card=>!selected.includes(card)&&feasible([...selected,card]));
    const sorted=selected=>available.filter(card=>selected.includes(card)).map(card=>card.id);
    if(done&&!extend.length)return targets({...command,cardIds:sorted(selected)},spec,selected.length);
    const choices=[...(done?[{...command,cardIds:sorted(selected),complete:true}]:[]),...extend.map(card=>({...command,cardIds:[...selected,card].map(c=>c.id)}))];
    const remainingCounts=validCounts.filter(count=>completion(available,count,selected,predicate)).map(count=>count-selected.length);
    const stepRequest={...request,count:validCounts.length===1?validCounts[0]:null,remainingCount:remainingCounts.length===1?remainingCounts[0]:null,
      remainingCounts,remainingMin:Math.min(...remainingCounts),remainingMax:Math.max(...remainingCounts),selectedIndices:selected.map(card=>player.hand.indexOf(card))};
    return node(stepRequest,'costCards',choices,value=>value.complete?
      targets({...command,cardIds:sorted(selected)},spec,selected.length):costs(command,detail,value.cardIds.map(id=>available.find(card=>card.id===id))),
      teacher=>{
        if(sameSet(teacher.cardIds??[],selected.map(c=>c.id)))return choices.findIndex(value=>value.complete);
        const next=extend.find(card=>teacher.cardIds?.includes(card.id));
        return choices.findIndex(value=>!value.complete&&value.cardIds.at(-1)===next?.id);
      },choices.map(()=>({cardIds:available.map(card=>card.id),targetIds:spec.targets})),{...command,cardIds:selected.map(card=>card.id)});
  }
  function skillChoice(){
    const entries=skills.map(entry=>({entry,modes:skillModes(entry)})).filter(item=>item.modes.length);
    const choices=entries.map(({entry})=>({type:'skill',skillId:entry.skillId}));
    return node(request,'skill',choices,(_,index)=>{
      const {entry,modes}=entries[index];
      const commands=modes.map(({mode})=>({type:'skill',skillId:entry.skillId,...(mode===undefined?{}:{mode})}));
      if(commands.length===1)return costs(commands[0],modes[0]);
      return node(request,'mode',commands,(value,i)=>costs(value,modes[i]),teacher=>commands.findIndex(value=>value.mode===teacher.mode),
        modes.map(detail=>({cardIds:detail.available.map(c=>c.id),targetIds:detail.spec.targets})),choices[index]);
    },teacher=>choices.findIndex(value=>value.skillId===teacher.skillId),entries.map(({entry})=>skillSummary([entry])));
  }
  function playChoice(type){
    const entries=cardEntries.filter(entry=>entry.card.type===type), choices=entries.map(entry=>({type:'play',index:entry.index}));
    return node(request,'card',choices,(value,index)=>{
      const targets=entries[index].targets.map(targetId=>({...value,targetId}));
      return node(request,'targets',targets,leaf,teacher=>targets.findIndex(c=>c.targetId===teacher.targetId),[],value);
    },teacher=>choices.findIndex(value=>value.index===teacher.index),entries.map(entry=>cardSummary([entry])));
  }
  function activationIntent(){
    const attacks=game.legalCards(playerId).filter(entry=>entry.card.type==='attack');
    const spells=game.legalCards(playerId).filter(entry=>entry.card.type==='spell');
    const normalSkills=game.legalSkillActions(playerId).filter(entry=>['attack','spell'].includes(entry.spec.type));
    // An intention never removes a legal activation: unknown draws/forms can
    // supply a continuation not currently represented by a concrete card.
    const intents=[{type:'flexible'},...(attacks.length?[{type:'attack'}]:[]),...(spells.length?[{type:'spell'}]:[]),
      ...normalSkills.map(entry=>({type:'skill',skillId:entry.skillId}))];
    const choices=intents.map(intent=>({type:'activate',intent}));
    const potentialActivation=activationSkillIds();
    const intentSummary=intent=>{
      let summary;
      if(intent.type==='attack'||intent.type==='spell')summary=cardSummary(intent.type==='attack'?attacks:spells);
      else if(intent.type==='skill')summary=skillSummary(normalSkills.filter(entry=>entry.skillId===intent.skillId));
      else {
        const cards=cardSummary([...attacks,...spells]), abilities=skillSummary(normalSkills);
        summary={cardIds:unique([...cards.cardIds,...abilities.cardIds]),targetIds:unique([...cards.targetIds,...abilities.targetIds]),skillIds:abilities.skillIds};
      }
      return {...summary,skillIds:unique([...potentialActivation,...(summary.skillIds??[])]),potentialActivationSkillIds:potentialActivation};
    };
    return node(request,'intent',choices,leaf,teacher=>{
      const action=teacher.plan?.action??teacher;
      const intent=teacher.intent??(action.type==='skill'?{type:'skill',skillId:action.skillId}:action.type==='play'?{type:playableCards(player)[action.index]?.type}:null);
      return intent?Math.max(0,choices.findIndex(value=>key(value.intent)===key(intent))):0;
    },intents.map(intentSummary));
  }
  const routes=[];
  const add=(direction,next,summary={})=>routes.push({direction,next,summary});
  if(state.completed)add('pass',()=>leaf({type:'pass'}));
  if(game.canRefreshUnableHand(playerId))add('refresh',()=>leaf({type:'refresh'}));
  if(game.canActivate(playerId)){
    const cards=cardSummary(game.legalCards(playerId)), abilities=skillSummary(game.legalSkillActions(playerId).filter(e=>e.spec.type!=='special'));
    add('activate',activationIntent,{cardIds:unique([...cards.cardIds,...abilities.cardIds]),targetIds:unique([...cards.targetIds,...abilities.targetIds]),
      skillIds:unique([...abilities.skillIds,...activationSkillIds()]),potentialActivationSkillIds:activationSkillIds()});
  }
  for(const type of ['attack','spell'])if(cardEntries.some(entry=>entry.card.type===type))add(type,()=>playChoice(type),cardSummary(cardEntries.filter(entry=>entry.card.type===type)));
  if(skills.length)add('heroSkill',skillChoice,skillSummary(skills));
  if(game.canDrawSpecial(playerId)){
    add('purchase',()=>leaf({type:'purchase'}));
    const choices=game.synthesisOptions(player.team).choices.map(gemCount=>({type:'synthesize',gemCount}));
    if(choices.length)add('synthesize',()=>node(request,'fees',choices,leaf,teacher=>choices.findIndex(value=>value.gemCount===teacher.gemCount)));
  }
  if(game.canRefine(playerId)){
    const stones=game.stoneCounts(player.team),choices=[];
    for(let gem=0;gem<=Math.min(2,stones.gem);gem++)for(let crystal=0;crystal<=Math.min(2,stones.crystal);crystal++)
      if(gem+crystal>=1&&gem+crystal<=2&&gem+crystal+player.energy.gem+player.energy.crystal<=game.getEnergyLimit(playerId))choices.push({type:'refine',stones:{gem,crystal}});
    if(choices.length)add('refine',()=>node(request,'fees',choices,leaf,teacher=>choices.findIndex(value=>value.stones.gem===teacher.stones.gem&&value.stones.crystal===teacher.stones.crystal)));
  }
  const choices=routes.map(({direction})=>({type:'direction',direction}));
  return node(request,'direction',choices,(_,index)=>routes[index].next(),teacher=>{
    const ordinary=teacher.type==='play'||(teacher.type==='skill'&&game.skillActionSpec(playerId,teacher)?.type!=='special');
    const direction=game.canActivate(playerId)&&ordinary?'activate':teacher.type==='play'?playableCards(player)[teacher.index]?.type:teacher.type==='skill'?'heroSkill':teacher.type;
    return choices.findIndex(value=>value.direction===direction);
  },routes.map(route=>route.summary));
}
