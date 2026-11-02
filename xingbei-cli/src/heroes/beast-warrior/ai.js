import {discardTarget,cheapCards,usefulExtra} from '../shared/ai/decisions.js';
export const beastWarriorAi={
  id:'beastWarrior',acceptsRefine:a=>a.stones.crystal===0,
  cardBonus:({card,same,player})=>card.type==='attack'?(same?4:12)+(card.fates.includes('J')&&player.hero.state.residual>=3?12:0):-4,
  resourceValue:p=>(p.heroState.souls??0)*3+(p.heroState.residual??0)*3,
  attackHitBonus:({player,active})=>active&&!player.heroState.form&&player.heroState.souls<2?3:0,
  decisions:{
    warriorResidual:()=>true,
    thoughtlessStrike:(a,api)=>usefulExtra(a,api),
    beastVigilance(a,api){return a.request.type==='skillChoice'?a.player.heroState.residual<4:discardTarget(a,api);},
    beastVigilanceDiscard:cheapCards,beastCounterCost:cheapCards,beastCounterDiscard:cheapCards,reverseIaidoDiscard:cheapCards,iaidoStanceDiscard:cheapCards,
    beastCounter(a){const n=Math.min(a.player.heroState.souls,Math.max(0,a.player.count+(a.context.amount??0)-a.player.limit));return a.request.choices.some(c=>c.value===n)?n:0;},
    reverseIaido({request,context,player,state,id},api){
      const target=state.players[context.targetId];let best={value:'skip',score:api.damageGain(state,id,target.id,context.amount??2,'attack')};
      for(const c of request.choices)if(typeof c.value==='number'){
        const next=api.copy(state);api.discardEstimate(next,target.id,c.value+2);if(target.count<c.value+2)next.teams[target.team].morale--;
        const score=api.evaluate(next)-api.evaluate(state)-Math.max(0,c.value-(4-player.heroState.residual))*3;
        if(score>best.score)best={value:c.value,score};}
      return best.value;
    },
    iaidoStance({request,player,source}){
      if(request.type==='skillChoice')return source.hand.some(c=>c.type==='attack')&&(player.heroState.souls<2||player.heroState.residual>=2);
      return player.count<=2?'draw':player.count>=player.limit?'discard':'skip';
    },
  },sharedDecisionSkills:['beastVigilanceDiscard','beastCounterDiscard','reverseIaidoDiscard'],
};
