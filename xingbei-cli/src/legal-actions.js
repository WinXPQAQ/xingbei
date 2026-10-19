// Shared exhaustive legal action enumeration; no strategy scores or hidden information.
const combinations=(items,n)=>n===0?[[]]:items.flatMap((item,i)=>combinations(items.slice(i+1),n-1).map(rest=>[item,...rest]));
export function legalActions(g,id) {
 if(g.winner || (g.turn.state && (g.turn.state.playerId!==id || g.turn.state.skipped || (g.turn.state.completed&&!g.turn.hasExtraActions()))))return [];
 const p=g.player(id),actions=g.turn.hasExtraActions()?[{type:'pass'}]:[];
 if(g.canRefreshUnableHand(id))actions.push({type:'refresh'});
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
