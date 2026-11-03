// Utilities operate only on detached observations, never on live engine state.
export function damageTarget({request,state,id},api,amount=1){
  return [...request.choices].sort((a,b)=>api.damageGain(state,id,b.value,amount)-api.damageGain(state,id,a.value,amount))[0]?.value??request.defaultValue;
}
export function discardTarget({request,state,id},api,count=1){
  const score=target=>{const next=api.copy(state);api.discardEstimate(next,target,count);return api.evaluate(next)-api.evaluate(state);};
  return [...request.choices].sort((a,b)=>score(b.value)-score(a.value))[0]?.value??request.defaultValue;
}
export function cheapCards({request,source,game,id},api){
  const reserved=new Set(game.turn.state?.reservedCardIds??[]);
  const cost=i=>api.cardScore(game,id,source.hand[i])+(reserved.has(source.hand[i].id)?1000:0);
  if(request.validSets)return [...request.validSets].sort((a,b)=>a.reduce((n,i)=>n+cost(i),0)-b.reduce((n,i)=>n+cost(i),0))[0]??null;
  return [...(request.valid??[])].sort((a,b)=>cost(a)-cost(b)).slice(0,request.count??1);
}
export function usefulExtra({source,player,state,id},api,selfDamage=0,cost=3){
  if(!source.hand.some(c=>c.type==='attack'))return false;
  const harm=api.damageGain(state,id,id,selfDamage);
  return harm>=-cost && state.teams[player.team].morale>Math.max(2,player.count+selfDamage-player.limit);
}
export function cheapCovered({request,game,id},api){
 const cards=request.choices.filter(c=>game.cards.has(c.value));
 return cards.sort((a,b)=>api.cardScore(game,id,game.cards.get(a.value))-api.cardScore(game,id,game.cards.get(b.value)))[0]?.value??request.defaultValue;
}
