const totalEnergy = p => p.energy.gem + p.energy.crystal;
const eligible = (card, id) => card.type === 'spell' || (card.traits?.[id]?.elements ?? card.elements).includes('thunder');
const inGroup = (card, id, mode) => mode === 'spell' ? card.type === 'spell' : (card.traits?.[id]?.elements ?? card.elements).includes('thunder');
function blackPlan(state, id, targetId, amount, api, choices = null) {
  const owner=state.players[id], target=state.players[targetId];
  if(!owner.heroState.form||owner.heroState.released||(!choices&&![1,2].includes(target.count)))return {count:0,score:0};
  const baseline=api.copy(state);api.hurt(baseline,targetId,amount,'attack',{sourceId:id});
  let best={count:0,score:0};
  for(const count of choices??Array.from({length:totalEnergy(owner)},(_,i)=>i+1)) {
    if(!count||count>totalEnergy(owner))continue;
    const next=api.copy(state);api.payEnergy(next,id,count,'crystal');
    api.hurt(next,targetId,amount+count+2,'attack',{sourceId:id});
    const score=api.evaluate(next)-api.evaluate(baseline);
    if(score>best.score)best={count,score};
  }
  return best;
}
function barrierPlan(a, api, { mode = null, counts = null, safeOnly = false } = {}) {
  const {state,id,game}=a, p=state.players[id], amount=a.context?.amount??0;
  const type=a.context?.damageType??'spell', sourceId=a.context?.sourceId;
  const before=api.evaluate(state), morale=state.teams[p.team].morale;
  const after=(cards)=>{
    const next=api.copy(state);api.spend(next,id,cards);
    api.hurt(next,id,amount,type,{sourceId});
    return next;
  };
  const baseline=after([]);
  let best={mode:'skip',count:0,cards:[],state:baseline,score:api.evaluate(baseline)-before};
  if(safeOnly&&baseline.teams[p.team].morale<morale)best.score=-Infinity;
  // No need to run cards solely because a harmless hit can draw replacements.
  if(!safeOnly&&p.count+amount<=p.limit)return best;
  for(const kind of mode?[mode]:['spell','thunder']) {
    const cards=p.hand.filter(c=>inGroup(c,id,kind)).sort((a,b)=>{
      const cost=c=>api.cardScore(game,id,game.cards.get(c.id))+(c.type==='attack'?6:0);
      return cost(a)-cost(b);
    });
    for(const n of counts??Array.from({length:Math.min(cards.length,Math.max(1,amount))},(_,i)=>i+1)) {
      if(n<1||n>cards.length)continue;
      const paid=cards.slice(0,n), next=after(paid);
      if(safeOnly&&next.teams[p.team].morale<morale)continue;
      let reserve=0;
      if(morale>8&&p.heroState.form&&!p.heroState.released&&totalEnergy(p)>0&&
         !next.players[id].hand.some(c=>eligible(c,id))) {
        // Keeping the last Abundance cost can create a low-hand black-lance
        // target next turn. It is an option, not a blanket license to lose morale.
        const future=Math.max(0,...state.players.filter(t=>t.team!==p.team&&t.count>=1&&t.count<=3).map(t=>{
          const preview=api.copy(state);preview.players[t.id].count=Math.max(1,t.count-1);
          return blackPlan(preview,id,t.id,2,api).score;
        }));
        reserve=Math.min(36,8+future*.4);
      }
      const score=api.evaluate(next)-before-api.cardCost(game,id,paid.map(c=>game.cards.get(c.id)))-reserve;
      if(score>best.score)best={mode:kind,count:n,cards:paid,state:next,score};
    }
  }
  return best;
}
function phantomPlan(a, api) {
  const {state,id}=a,p=state.players[id];
  const defense=barrierPlan({...a,context:{amount:2,damageType:'spell',sourceId:id}},api,{safeOnly:true});
  if(!Number.isFinite(defense.score)||api.terminal(defense.state))return null;
  const next=defense.state, owner=next.players[id];
  owner.heroState.form=null;owner.limit++;
  let best=null;
  for(const target of state.players) {
    const result=api.copy(next);api.hurt(result,target.id,2,'spell',{sourceId:id});
    const score=api.evaluate(result)-api.evaluate(state)-api.cardCost(a.game,id,defense.cards.map(c=>a.game.cards.get(c.id)));
    if(!best||score>best.score)best={state:result,targetId:target.id,score};
  }
  return best;
}
function releaseState(state,id,api) {
  const next=api.copy(state),p=next.players[id];
  Object.assign(p.heroState,{form:'phantom',attackBonus:1,released:true});
  api.lowerHandLimit(next,id,Math.max(0,p.limit-1));
  return next;
}
export const magicLancerAi = {
  id: 'magicLancer', energyPreference: 'crystal', acceptsRefine: () => true,
  sharedDecisionSkills: ['abundance'],
  cardBonus: ({ card, elements, same }) => card.type==='spell'?10:elements.includes('thunder')?(same?8:22):0,
  attackDamage: ({ player, active }) => active ? player.heroState.attackBonus??0 : 0,
  afterAttackResolved: ({player,active}) => {if(active)player.heroState.attackBonus=0;},
  resourceValue: p => p.energy.crystal*3+(p.heroState.form?3:0),
  refineBonus({state,id,player,crystal}) {
    if(totalEnergy(player))return 0;
    const lowLimits=state.players.filter(p=>p.id!==id&&(p.limit<5||p.hero==='bloodWitch')).length;
    const targets=state.players.filter(p=>p.team!==player.team&&p.count>=1&&p.count<=3).length;
    const teamNeed=state.players.filter(p=>p.team===player.team&&p.id!==id&&totalEnergy(p)===0).length;
    return crystal?4+Math.min(6,lowLimits*2)+(player.heroState.form&&targets?5:0)-(teamNeed>1?2:0):0;
  },
  attackHitBonus({state,id,targetId,amount,active},api) {
    return active?blackPlan(state,id,targetId,amount,api).score:0;
  },
  preparations(a,api) {
    const {state,id,player,options}=a;
    if(player.heroState.form) {
      const plan=phantomPlan(a,api);
      if(plan)options.push({state:plan.state,activated:'phantomStars'});
    } else if(a.card?.type==='attack')options.push({state:releaseState(state,id,api),activated:'darkRelease'});
    return options;
  },
  scoreSkill({ game,next,player,skillId,id }, api) {
    if(skillId!=='abundance')return null;
    // Enemy discards are compulsory; their identities remain unknown. Do not
    // assume that they donate a thunder/spell bonus. Optional ally payments are
    // valued later by each ally, after their own hand is legitimately observed.
    for(const p of next.players)if(p.team!==player.team)api.discardEstimate(next,p.id,1);
    return api.terminal(next)?0:api.bestAttackScore(game,id,next).score;
  },
  decisions: {
    darkRelease(a,api) {
      if(!a.player.hand.some(c=>c.type==='attack'))return false;
      const next=releaseState(a.state,a.id,api);
      return !api.terminal(next)&&api.evaluate(next)-api.evaluate(a.state)+api.bestAttackScore(a.game,a.id,next).score>
        api.bestAttackScore(a.game,a.id,a.state).score;
    },
    phantomStars(a,api) {
      if(a.request.type==='playerChoice')return [...a.request.choices].sort((x,y)=>
        api.damageGain(a.state,a.id,y.value,2,'spell',{sourceId:a.id})-api.damageGain(a.state,a.id,x.value,2,'spell',{sourceId:a.id}))[0]?.value;
      const plan=phantomPlan(a,api);
      if(!plan)return false;
      const before=api.bestAttackScore(a.game,a.id,a.state).score;
      const after=api.terminal(plan.state)?0:api.bestAttackScore(a.game,a.id,plan.state).score;
      return plan.score+after>before;
    },
    darkBarrier(a,api) {
      const {request,source,game,id}=a;
      if(request.type==='cardChoice')return [...request.valid].sort((x,y)=>
        api.cardScore(game,id,source.hand[x])-api.cardScore(game,id,source.hand[y])).slice(0,request.count);
      if(request.choices.some(c=>c.value==='skip'))return barrierPlan(a,api).mode;
      const mode=a.context.mode??(source.hand.filter(c=>c.type==='spell').length===request.choices.length?'spell':'thunder');
      const plan=barrierPlan(a,api,{mode,counts:request.choices.map(c=>c.value)});
      return request.choices.some(c=>c.value===plan.count)?plan.count:request.choices[0].value;
    },
    pitchBlackLance({request,state,id,context},api) {
      return blackPlan(state,id,context.targetId,context.amount,api,request.choices.map(c=>c.value)).count;
    },
    abundance({ request,game,id,state,source,context },api) {
      const caster=state.players[context.sourceId];
      if(!caster||request.type!=='cardChoice')return request.defaultValue;
      const friendly=caster.team===state.players[id].team, amount=2+(caster.heroState.attackBonus??0);
      const gains=state.players.filter(p=>p.team!==caster.team).map(p=>
        (api.damageGain(state,id,p.id,amount+1,'attack',{sourceId:caster.id})-api.damageGain(state,id,p.id,amount,'attack',{sourceId:caster.id}))*0.75**p.count);
      const marginal=friendly?Math.max(0,...gains):Math.min(0,...gains);
      const bonusValue=caster.count>0?marginal+(friendly?2.5:-2.5):0;
      let best={index:null,score:request.optional?0:-Infinity};
      for(const index of request.valid) {
        const card=source.hand[index],next=api.copy(state),samePlayer=id===caster.id;
        // The caster already paid the skill's one thunder/spell. A second such
        // card gives no bonus; keep it for barrier or a later Abundance.
        if(samePlayer&&eligible(card,id))continue;
        if(samePlayer&&card.type==='attack'&&state.players[id].hand.filter(c=>c.type==='attack').length<=1)continue;
        api.spend(next,id,[next.players[id].hand.find(c=>c.id===card.id)]);
        const addsDamage=!samePlayer&&eligible(card,id);
        const score=api.evaluate(next)-api.evaluate(state)-api.cardCost(game,id,[card])+(addsDamage?bonusValue:0);
        if(score>best.score)best={index,score};
      }
      return best.index==null?null:[best.index];
    },
  },
};
