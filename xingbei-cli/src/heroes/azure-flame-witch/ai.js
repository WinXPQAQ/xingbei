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
const outputValue=(game,id,state,api)=>api.terminal(state)?0:Math.max(api.bestAttackScore(game,id,state).score,api.bestSpellFollow(game,id,state));

export const azureFlameWitchAi = {
  id: 'azureFlameWitch', energyPreference: "crystal",
  cardBonus: ({ card, elements, retained }) => elements.includes('fire') ? 18 :
    card.type === 'spell' && retained.filter(c => c.type === 'spell').length < 2 ? 12 : 0,
  resourceValue: p => (p.heroState.rebirth ?? 0) * 3 + p.energy.crystal * 2,
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
    substituteDoll({ request, state, player, game, id }, { cardCost }) {
      const allies = state.players.filter(p => p.team === player.team && p.id !== id && p.count < p.limit);
      if (request.type === 'playerChoice') return allies.sort((a,b) => a.count - b.count)[0]?.id ?? request.defaultValue;
      if (!allies.length) return null;
      const sorted = [...request.valid].sort((a,b) => cardCost(game,id,[game.player(id).hand[a]]) - cardCost(game,id,[game.player(id).hand[b]]));
      return sorted.length ? [sorted[0]] : null;
    },
    manaInversion({ request, game, id, state, player, context }, { cardCost, damageGain }) {
      const enemies = state.players.filter(p => p.team !== player.team);
      if (request.type === 'playerChoice') return enemies.sort((a,b) => damageGain(state,id,b.id,context.amount??0)-damageGain(state,id,a.id,context.amount??0))[0].id;
      let best = { indexes: null, score: 0 };
      for (const indexes of request.validSets ?? []) {
        const score = Math.max(...enemies.map(p => damageGain(state,id,p.id,indexes.length-1))) - cardCost(game,id,indexes.map(i=>game.player(id).hand[i])) - 3;
        if (score > best.score) best = { indexes, score };
      }
      return best.indexes;
    },
  },
};
