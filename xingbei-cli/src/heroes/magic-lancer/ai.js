export const magicLancerAi = {
  id: 'magicLancer', energyPreference: "crystal", acceptsRefine: () => true,
  sharedDecisionSkills: ['abundance'],
  cardBonus: ({ card, elements, same }) => card.type === 'spell' ? 5 : elements.includes('thunder') && !same ? 16 : 0,
  attackDamage: ({ player }) => player.heroState.attackBonus ?? 0,
  resourceValue: p => p.energy.crystal * 3,
  scoreSkill({ next, player, skillId, id }, { discardEstimate, bestAttackScore, game }) {
    if (skillId !== 'abundance') return null;
    for (const p of next.players) if (p.team !== player.team) discardEstimate(next, p.id, 1);
    return player.hand.some(c => c.type === 'attack') ? 5 : -20;
  },
  decisions: {
    darkRelease: ({ game, id, player }) => player.count <= 5 && game.player(id).hand.some(c => c.type === 'attack'),
    phantomStars({ state, id, player, request }, { damageGain }) {
      const best = state.players.filter(p => p.team !== player.team).sort((a,b) => damageGain(state,id,b.id,2)-damageGain(state,id,a.id,2))[0];
      return request.type === 'skillChoice' ? player.count + 2 <= player.limit : best.id;
    },
    darkBarrier({ request, source, player, context, game, id }, { lowCards, cardCost, elements }) {
      if (request.type === 'cardChoice') return lowCards(game,id,request.valid).slice(0,request.count);
      const needed=Math.max(0,player.count+(context.amount??0)-player.limit);
      if (request.choices.some(c=>c.value==='skip')) {
        if (!needed) return 'skip';
        const modes=request.choices.filter(c=>c.value!=='skip').map(choice=>{
          const valid=source.hand.map((card,index)=>({card,index})).filter(({card})=>
            choice.value==='spell'?card.type==='spell':elements(game,id,card).includes('thunder')).map(({index})=>index);
          const indexes=lowCards(game,id,valid).slice(0,needed);
          return {mode:choice.value,score:cardCost(game,id,indexes.map(i=>source.hand[i]))+Math.max(0,needed-indexes.length)*30};
        });
        return modes.sort((a,b)=>a.score-b.score)[0]?.mode??'skip';
      }
      return [...request.choices].sort((a,b)=>Math.abs(a.value-needed)-Math.abs(b.value-needed)||a.value-b.value)[0].value;
    },
    pitchBlackLance({ request, state, id, context }, { damageGain }) {
      let best = { n: 0, score: 0 };
      for (const c of request.choices) if (c.value) {
        const score = damageGain(state,id,context.targetId,context.amount+c.value+2,'attack')-damageGain(state,id,context.targetId,context.amount,'attack')-c.value*4;
        if (score > best.score) best = { n:c.value, score };
      }
      return best.n;
    },
    abundance({ request, game, id, state, source, context }, api) {
      const caster=state.players[context.sourceId];
      if (!caster || request.type!=='cardChoice') return request.defaultValue;
      const friendly=caster.team===state.players[id].team, amount=2+(caster.heroState.attackBonus??0);
      // The caster's hand is hidden here. Public pressure estimates the next
      // attack's value; only this deciding player's actual payment is inspected.
      const gains=state.players.filter(p=>p.team!==caster.team).map(p=>
        (api.damageGain(state,id,p.id,amount+1,'attack')-api.damageGain(state,id,p.id,amount,'attack'))*0.75**p.count);
      const marginal=friendly?Math.max(0,...gains):Math.min(0,...gains);
      const bonusValue=caster.count>0?marginal+(friendly?2.5:-2.5):0;
      let best={index:null,score:request.optional?0:-Infinity};
      for (const index of request.valid) {
        const card=source.hand[index], next=api.copy(state);
        api.spend(next,id,[next.players[id].hand.find(c=>c.id===card.id)]);
        const addsDamage=id!==caster.id&&(card.type==='spell'||api.elements(game,id,card).includes('thunder'));
        const score=api.evaluate(next)-api.evaluate(state)-api.cardCost(game,id,[card])+(addsDamage?bonusValue:0);
        if(score>best.score)best={index,score};
      }
      return best.index==null?null:[best.index];
    },
  },
};
