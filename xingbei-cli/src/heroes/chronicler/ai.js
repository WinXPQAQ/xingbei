import { createDeck } from '../../cards.js';
import { cardData } from '../shared/ai/base/model.js';
import { actionPlan, probability } from '../shared/ai/base/planner.js';
import { cheapCards, cheapCovered, damageTarget } from '../shared/ai/decisions.js';
const ruins = source => source.covered.filter(c=>c.location.pile==='ruins');
// Distribution of the first repeated suit in the printed deck. This is a fixed
// prior, not a read of the current deck, hidden cards, or the next reveal.
const printed=createDeck(),counts=new Map();
for(const card of printed)counts.set(card.elements[0],(counts.get(card.elements[0])??0)+1);
const groups=[...counts.values()];
const states=new Map([[0,1]]),revealRates=new Map();
for(let mask=0;mask<1<<groups.length;mask++){
 const chance=states.get(mask)??0,drawn=mask.toString(2).replaceAll('0','').length;
 if(!chance)continue;
 for(let i=0;i<groups.length;i++){
  const seen=!!(mask&1<<i),part=chance*(groups[i]-Number(seen))/(printed.length-drawn);
  if(seen)revealRates.set(drawn+1,(revealRates.get(drawn+1)??0)+part);
  else states.set(mask|1<<i,(states.get(mask|1<<i)??0)+part);
 }
}
function discardOne(a,state,api){
 const index=api.chooseAiDiscard(a.game,a.id,1)[0],card=a.source.hand[index];
 if(card)api.remove(state,a.id,[state.players[a.id].hand.find(c=>c.id===card.id)]);
 return card?api.cardCost(a.game,a.id,[card]):0;
}
function archives(a,state,count,api){
 const p=state.players[a.id];p.heroState.archives=Math.min(3,p.heroState.archives+count);
 if(p.heroState.archives<3)return;
 p.heroState.archives=0;
 api.discardEstimate(state,a.id,1);
 const book=a.game.cards.get(p.heroState.bookCardId);
 if(book?.location.zone==='outside'){
  p.hand.push(cardData(book));p.count++;api.overflow(state,a.id);
 }
}
function revealedPlan(a,api,card,targetIds,payCost=true){
 const next=api.copy(a.state),p=next.players[a.id];
 const cost=payCost?discardOne(a,next,api):0;
 let best={targetId:null,score:-Infinity};
 for(const targetId of targetIds){
  let branches;
  if(card.type==='attack'){
   const played=api.copy(next);played.players[a.id].coveredCount=Math.max(0,p.coveredCount-1);
   branches=api.attackOutcomes(a.game,a.id,played,card,targetId,{alreadyPlayed:true});
  }else{
   const playing=api.copy(next),owner=playing.players[a.id];owner.hand.push({...cardData(card),reserve:true});
   branches=actionPlan(playing,a.id,{type:'play',index:owner.hand.length-1,targetId},{sequence:false}).branches;
  }
  for(const branch of branches)if(!api.terminal(branch.state)){
   branch.state.players[a.id].coveredCount=Math.max(0,branch.state.players[a.id].coveredCount-1);
   archives(a,branch.state,1,api);
  }
  const score=branches.reduce((sum,b)=>sum+b.probability*api.evaluate(b.state),0)-api.evaluate(a.state)-cost;
  if(score>best.score)best={targetId,score};
 }
 return best;
}
function studyTargets(a,card){
 const foes=a.state.players.filter(p=>p.team!==a.player.team);
 if(card.name==='holyShield')return a.state.players.filter(p=>!p.effects.some(e=>e.name==='holyShield')).map(p=>p.id);
 if(card.name==='weakness')return foes.filter(p=>!p.effects.some(e=>e.name==='weakness')).map(p=>p.id);
 if(card.name==='magicBullet')return [foes.sort((x,y)=>(x.id-a.id+6)%6-(y.id-a.id+6)%6)[0].id];
 return foes.map(p=>p.id);
}
function rebuttalPlan(a,api){
 const selected=a.context.selectedCardIds??[],all=ruins(a.source),available=a.request.choices.filter(c=>a.game.cards.has(c.value));
 const costs=available.map(c=>a.game.cards.get(c.value)).sort((x,y)=>api.cardScore(a.game,a.id,x)-api.cardScore(a.game,a.id,y));
 const card=a.context.card,targetId=a.context.targetId;
 if(!card||targetId==null)return {cards:selected,score:0};
 const hit=probability(a.state,a.id,card,targetId).hit;
 let best={cards:selected,score:selected.length?-Infinity:0};
 for(let n=Math.max(1,selected.length);n<=selected.length+costs.length;n++){
  const chosen=[...selected,...costs.slice(0,n-selected.length).map(c=>c.id)],next=api.copy(a.state);
  next.players[a.id].coveredCount=Math.max(0,a.player.coveredCount-n);
  if(n===all.length)api.stones(next,a.player.team,'gem',1);
  const base=a.context.amount??2;
  const damage=hit*(api.damageGain(next,a.id,targetId,base+n-1,'attack')-api.damageGain(next,a.id,targetId,base,'attack'));
  // Two ruins also grant a spell action; unity remains available without a hand
  // cost, so an extra spell can refill the archive cycle rather than be wasted.
  const follow=n>1?Math.max(4,api.bestSpellFollow(a.game,a.id,next)):0;
  const score=api.evaluate(next)-api.evaluate(a.state)+damage+follow;
  if(score>best.score)best={cards:chosen,score};
 }
 return best;
}
export const chroniclerAi={
 id:'chronicler',energyPreference:'crystal',
 cardBonus:({card})=>card.name==='chronicle'?35:card.type==='attack'?7:0,
 resourceValue:p=>(p.heroState.archives??0)*3+(p.coveredCount??0)*2,
 refineBonus:({player})=>!player.energy.gem&&!player.energy.crystal?1:0,
 scoreSkill(a,api){
  const {game,next,id,player,skillId}=a;
  if(skillId==='unityOfKnowledge'){
   archives({...a,source:game.player(id)},next,1,api);
   return 4+Math.min(3,Math.max(0,player.count-3));
  }
  if(skillId!=='myriadRuins')return null;
  const book=player.hand.find(c=>c.id===player.heroState.bookCardId);
  if(book)api.remove(next,id,[book]);player.coveredCount=0;
  const before=api.evaluate(next);let gain=0;
  for(const[n,chance]of revealRates){
   const branch=api.copy(next);branch.players[id].coveredCount=n;
   if(n>3){
    const ids=branch.players.map(p=>({id:p.id,value:api.damageGain(branch,id,p.id,2)}))
     .sort((x,y)=>y.value-x.value).slice(0,n-3).map(p=>p.id).sort((x,y)=>(x-id+6)%6-(y-id+6)%6);
    for(const target of ids)if(!api.terminal(branch))api.hurt(branch,target,2,'spell',{sourceId:id});
   }
   gain+=chance*(api.evaluate(branch)-before);
  }
  return gain;
 },
 decisions:{
  studyCard(a,api){
   const pass=api.copy(a.state);pass.players[a.id].coveredCount=Math.max(0,a.player.coveredCount-2);archives(a,pass,2,api);
   let best={id:null,score:api.evaluate(pass)-api.evaluate(a.state)};
   for(const choice of a.request.choices){const card=a.game.cards.get(choice.value);if(!card)continue;
    const plan=revealedPlan(a,api,card,studyTargets(a,card));if(plan.score>best.score)best={id:card.id,score:plan.score};
   }
   return best.id;
  },
  studyTarget:(a,api)=>revealedPlan(a,api,a.context.card,a.request.choices.map(c=>c.value),false).targetId??a.request.defaultValue,
  ruinRebuttal(a,api){const chosen=rebuttalPlan(a,api).cards,selected=new Set(a.context.selectedCardIds??[]);return chosen.find(id=>!selected.has(id))??null;},
  ruinOverflow:cheapCovered,historicalCompilation:()=>true,archiveExchangeHand:cheapCards,
  archiveExchangeRuins:({request,game,id},api)=>request.choices.filter(c=>game.cards.has(c.value))
   .sort((a,b)=>api.cardScore(game,id,game.cards.get(b.value))-api.cardScore(game,id,game.cards.get(a.value)))[0]?.value??null,
  myriadTargets:(a,api)=>damageTarget(a,api,2),
  pastPresent:({player,request})=>player.energy.gem+player.energy.crystal>(request.reservedEnergy??0)&&
   (player.heroState.archives>0||player.count>=3),
 },
};
