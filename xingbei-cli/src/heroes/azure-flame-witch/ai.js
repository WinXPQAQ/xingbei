import {fireReadiness,isKnownFire} from './fire-forecast.js';

const ownFire=player=>player.hand.filter(card=>!card.reserve&&isKnownFire(card,player.id));
// Unknown draws may open a two-fire spell. This is a fixed-deck opportunity
// estimate, not a guessed card or an extra simulated legal action.
function unknownFireOption(state,id) {
  const player=state.players[id],known=player.hand.filter(card=>!card.reserve);
  if(ownFire(player).length>=2)return 0;
  return 7*fireReadiness(known,Math.max(0,player.count-known.length),id,player.heroState.form);
}
const inversionReserve=player=>player.energy.gem+player.energy.crystal>0&&player.hand.filter(card=>!card.reserve&&card.type==='spell').length>=2?10:0;
const incoming=(request,context,type)=>({amount:context.amount??request.damage??2,type:context.damageType??type,sourceId:context.sourceId??context.actorId});
function takeIncoming(state,id,damage,api) {
  if(!api.terminal(state))api.hurt(state,id,damage.amount,damage.type,{sourceId:damage.sourceId});
}

// Preview only the owner's known cards. Draws add unknown card count, never
// inspect the deck or assume that the next card is fire.
function wrathOptions(state, id, api) {
  const player=state.players[id];
  if(player.heroState.form||player.count>=4)return [];
  return [0,1,2].map(count=>{
    const next=api.copy(state), p=next.players[id];
    p.heroState.form='flame';
    for(const card of p.hand)if(card.type==='attack') {
      const elements=[...new Set((card.traits?.[id]?.elements??card.elements).map(e=>['water','dark'].includes(e)?e:'fire'))];
      card.elements=elements;
      card.traits={...card.traits,[id]:{...card.traits?.[id],elements}};
    }
    api.lowerHandLimit(next,id,p.limit+(p.heroState.rebirth??0)-2);
    if(!api.terminal(next))api.draw(next,id,count);
    if(count)next.uncertain=true;
    next.witchWrathPreview=true;
    return {state:next,count,activated:'witchWrath'};
  });
}
const outputValue=(game,id,state,api)=>api.terminal(state)?0:Math.max(api.bestAttackScore(game,id,state).score,api.bestSpellFollow(game,id,state))+unknownFireOption(state,id);

export const azureFlameWitchAi = {
  id: 'azureFlameWitch', energyPreference: "crystal",
  cardBonus: ({ card, elements, retained }) => elements.includes('fire') ? 42 :
    card.type === 'spell' && retained.filter(c => c.type === 'spell').length < 2 ? 16 : 0,
  resourceValue: p => [0,30,54,68,76][Math.min(4,p.heroState.rebirth??0)] + p.energy.crystal * 3 + inversionReserve(p),
  refineBonus:({player,crystal})=>crystal&&!player.energy.crystal&&!player.energy.gem?
    (player.hand.filter(card=>card.type==='spell').length>=2||player.count>=4?8:3):0,
  afterDamage({player,type,moraleLost}) {
    if(type!=='spell'||!moraleLost||(player.heroState.rebirth??0)>=4)return;
    player.heroState.rebirth=(player.heroState.rebirth??0)+1;
    if(player.heroState.form)player.limit++;
  },
  preparations({state,id,options},api) {
    return [...options,...wrathOptions(state,id,api)];
  },
  actionBonus({game,state,id,action},api) {
    if(!state.witchWrathPreview||action.type!=='play')return 0;
    const card=game.player(id).hand[action.index];
    if(card?.type!=='attack')return 0;
    // The provisional attack may become a stronger fire spell after activation.
    const attack=api.attackScore(game,id,state,card,action.targetId);
    return Number.isFinite(attack)?Math.max(0,api.bestSpellFollow(game,id,state)-attack):0;
  },
  spellActions({state,id,player},{foes}) {
    const fire=player.hand.filter(c=>(c.traits?.[id]?.elements??c.elements).includes('fire')), actions=[];
    for(const target of foes(state,id))for(let i=0;i<fire.length;i++) {
      actions.push({type:'skill',skillId:'azureCodex',cardIds:[fire[i].id],targetIds:[target.id]});
      if(player.heroState.form||player.heroState.rebirth>0)for(let j=i+1;j<fire.length;j++)
        actions.push({type:'skill',skillId:'skyfireRift',cardIds:[fire[i].id,fire[j].id],targetIds:[target.id]});
    }
    return actions;
  },
  scoreSkill({ next, id, targetId, skillId, player }, { hurt, discardEstimate, terminal }) {
    const amounts = { azureCodex: 2, skyfireRift: 3, painLink: 1 };
    if (!(skillId in amounts)) return null;
    let amount = amounts[skillId];
    if (skillId === 'skyfireRift') {
      if (!player.heroState.form) player.heroState.rebirth--;
      if (next.teams[player.team].morale < next.teams[next.players[targetId].team].morale) amount++;
    }
    hurt(next, targetId, amount);
    if (terminal(next)) return 0;
    hurt(next, id, amount);
    if (terminal(next)) return 0;
    if (skillId === 'painLink') discardEstimate(next, id, Math.max(0, player.count - 3));
    return 0;
  },
  decisions: {
    witchWrath({request,player,state,game,id},api) {
      if(request.type==='skillChoice') {
        const before=api.evaluate(state)+outputValue(game,id,state,api);
        return wrathOptions(state,id,api).some(({state:next})=>
          api.evaluate(next)+outputValue(game,id,next,api)>before+0.5);
      }
      if(request.type!=='numberChoice')return request.defaultValue;
      // The form and its new hand limit already exist at the draw question.
      const scores=request.choices.map(choice=>{
        const next=api.copy(state);api.draw(next,id,choice.value);
        return {value:choice.value,score:api.evaluate(next)+outputValue(game,id,next,api)};
      });
      return scores.sort((a,b)=>b.score-a.score||a.value-b.value)[0]?.value??request.defaultValue;
    },
    substituteDoll({ request, state, player, game, id, context }, api) {
      if(request.type==='playerChoice')return request.choices.map(choice=>{
        const next=api.copy(state);api.draw(next,choice.value,1);
        return {value:choice.value,score:api.evaluate(next)};
      }).sort((a,b)=>b.score-a.score)[0]?.value??request.defaultValue;
      const allies=state.players.filter(p=>p.team===player.team&&p.id!==id);
      const damage=incoming(request,context,'attack'),baseline=api.copy(state);
      takeIncoming(baseline,id,damage,api);
      let best={indexes:null,score:api.evaluate(baseline)};
      for(const index of request.valid??[])for(const ally of allies) {
        const next=api.copy(state),card=next.players[id].hand.find(c=>c.id===game.player(id).hand[index].id);
        api.spend(next,id,[card]);api.draw(next,ally.id,1);takeIncoming(next,id,damage,api);
        const score=api.evaluate(next)-api.cardCost(game,id,[game.player(id).hand[index]]);
        if(score>best.score)best={indexes:[index],score};
      }
      return best.indexes;
    },
    manaInversion({ request, game, id, state, player, context }, api) {
      if(request.type==='playerChoice')return request.choices.map(choice=>({value:choice.value,
        score:api.damageGain(state,id,choice.value,context.amount??0),
      })).sort((a,b)=>b.score-a.score)[0]?.value??request.defaultValue;
      const enemies=state.players.filter(p=>p.team!==player.team),damage=incoming(request,context,'spell');
      const baseline=api.copy(state);takeIncoming(baseline,id,damage,api);
      let best={indexes:null,score:api.evaluate(baseline)};
      // The engine supplies legal sets; no extra subset enumeration is needed.
      for(const indexes of request.validSets??[])for(const enemy of enemies) {
        const next=api.copy(state),cards=indexes.map(index=>game.player(id).hand[index]);
        api.payEnergy(next,id);api.spend(next,id,cards.map(card=>next.players[id].hand.find(c=>c.id===card.id)));
        api.hurt(next,enemy.id,indexes.length-1,'spell',{sourceId:id});
        takeIncoming(next,id,damage,api);
        const score=api.evaluate(next)-api.cardCost(game,id,cards);
        if(score>best.score)best={indexes,score};
      }
      return best.indexes;
    },
  },
};
