// Confidence, not a label of actual possession. A cheap accepted hit provides
// little evidence; public overflow risk strengthens it. Hidden cards never label it.
export function costBeliefs(game) {
 const result=new Map();
 for(const e of game.publicHistory?.events ?? []) {
  if(e.type==='turn') {for(const gap of result.values())for(const k of Object.keys(gap))gap[k]*=.92;continue;}
  if(!result.has(e.playerId))result.set(e.playerId,{});
  const gap=result.get(e.playerId),decay=e.type==='gain'?.62:e.type==='leave'?.88:1;
  for(const k of Object.keys(gap))gap[k]*=decay;
  if(e.type==='unanswered') {
   const strength=.08+.27*Math.min(1,(e.acceptCost??0)/2);
   for(const element of e.elements)gap[element]=Math.min(.7,(gap[element]??0)+strength*(1-(gap[element]??0)));
   gap.light=Math.min(.5,(gap.light??0)+strength/3);
  } else if(e.type==='leave'&&e.elements)for(const element of e.elements)gap[element]=Math.min(.7,(gap[element]??0)+.10);
 }
 return result;
}
