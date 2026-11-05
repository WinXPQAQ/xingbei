// A bounded card/resource sequence, never a list of preassigned opponents.
// Each real attack is scored against the then-current legal targets again.
const traits = (card, id) => card.traits?.[id] ?? card;
const has = (card, skill) => card?.uniqueSkills?.includes(skill) ?? false;
const wind = (card, id) => traits(card, id).elements?.includes('wind');
const nextSlot = queue => {
  const restricted = queue.findLastIndex(action => action.element || action.fate);
  return restricted < 0 ? 0 : restricted;
};

export function planWindSequence(player, turn = null, {
  offer = null, card = null, energy = null, firstCardId = null, teamStones = 0,
} = {}) {
  const skills = new Set(player.skillIds ?? []), id = player.id;
  const cards = player.hand.filter(card => card.type === 'attack');
  const startCount = turn?.attackCount ?? 0, used = turn?.usedSkills ?? {};
  const pending = (turn?.pendingActions ?? []).map(action => ({ ...action }));
  const availableEnergy = energy ?? player.energy.gem + player.energy.crystal;
  const child = skills.has('windSword');
  const shadowSkill = child ? 'swordAfterimage' : 'swordShadow';
  const shadowUsed = child ? player.heroState?.residualUsed : used.swordShadow;
  let best = { count:startCount, score:-Infinity, steps:[], offers:[], energyCost:0, stoneCost:0, preference:0 };
  function finish(count, energyCost, stoneCost, preference, steps, offers) {
    const score = count * 1000 - energyCost * 50 - stoneCost * 55 + preference;
    if (score > best.score) best = { count, score, steps, offers, energyCost, stoneCost, preference };
  }
  function ready(hand, count, queue, furyUsed, extraUsed, energyLeft, stonesLeft, energyCost, stoneCost, preference, steps, offers, initial = false) {
    finish(count, energyCost, stoneCost, preference, steps, offers);
    if (count >= 3 || (!initial && !queue.length)) return;
    const slot = nextSlot(queue), restriction = initial ? null : queue[slot];
    if (restriction && restriction.type !== 'attack') return;
    for (const next of hand) {
      if (!steps.length && firstCardId != null && next.id !== firstCardId) continue;
      const current = traits(next, id);
      if ((restriction?.element && !current.elements.includes(restriction.element)) ||
          (restriction?.fate && !current.fates.includes(restriction.fate))) continue;
      const rest = hand.filter(card => card !== next), nextQueue = [...queue];
      if (!initial) nextQueue.splice(slot, 1);
      const order = preference + (has(next,'galeArt') ? (wind(next,id) && count === 1 ? 15 : 4) : 0)
        - (count === 0 && wind(next,id) ? 12 : 0);
      after(rest, count + 1, nextQueue, furyUsed, extraUsed, energyLeft, stonesLeft, energyCost, stoneCost, order,
        [...steps,next.id], offers, next, null, false);
    }
  }
  function after(hand, count, queue, furyUsed, extraUsed, energyLeft, stonesLeft, energyCost, stoneCost, preference, steps, offers, played, offered, root) {
    const choices = [];
    const allowed = skill => !offered || skill === offered ||
      (offered === 'galeArt' && ['windFury','swordShadow'].includes(skill)) ||
      (offered === 'windFury' && skill === 'swordShadow') ||
      (offered === 'windSword' && skill === 'swordAfterimage');
    if (skills.has('galeArt') && allowed('galeArt') && has(played,'galeArt'))
      choices.push({ skill:'galeArt', action:{type:'attack',sourceSkillId:'galeArt'} });
    if (child && allowed('windSword') && has(played,'galeArt') && traits(played,id).fates?.includes('J') && stonesLeft > 0)
      choices.push({ skill:'windSword', stone:1, action:{type:'attack',sourceSkillId:'windSword'} });
    if (skills.has('windFury') && allowed('windFury') && !furyUsed && hand.some(card => wind(card,id)))
      choices.push({ skill:'windFury', action:{type:'attack',element:'wind',sourceSkillId:'windFury'} });
    if (skills.has(shadowSkill) && allowed(shadowSkill) && !extraUsed && energyLeft > 0)
      choices.push({ skill:shadowSkill, energy:1, action:{type:'attack',sourceSkillId:shadowSkill} });
    for (let mask=0; mask < 2 ** choices.length; mask++) {
      const selected = choices.filter((_,index) => mask & (1 << index));
      const e = selected.reduce((sum,c) => sum + (c.energy ?? 0),0), t = selected.reduce((sum,c) => sum + (c.stone ?? 0),0);
      ready(hand,count,[...queue,...selected.map(c=>c.action)],furyUsed || selected.some(c=>c.skill==='windFury'),
        extraUsed || selected.some(c=>c.skill===shadowSkill),energyLeft-e,stonesLeft-t,energyCost+e,stoneCost+t,preference,
        steps,root ? selected.map(c=>c.skill) : offers);
    }
  }
  if (offer) after(cards,startCount,pending,!!used.windFury,!!shadowUsed,availableEnergy,teamStones,0,0,0,[],[],card,offer,true);
  else ready(cards,startCount,pending,!!used.windFury,!!shadowUsed,availableEnergy,teamStones,0,0,0,[],[],!turn?.completed);
  return best;
}

export function planWindState(state, playerId, options = {}) {
  const player = state.players[playerId], team = state.teams[player.team];
  return planWindSequence(player,state.turn?.playerId === playerId ? state.turn : null,
    { teamStones:team.gem + team.crystal,...options });
}

export function planWindAttacks(game, playerId, options = {}) {
  const player = game.player(playerId);
  const own = { id:playerId, energy:player.energy, heroState:player.hero.state,
    skillIds:player.getSkills().map(({skill}) => typeof skill === 'string' ? skill : skill.id),
    hand:player.hand.map(card => ({id:card.id,type:card.type,uniqueSkills:card.uniqueSkills,...card.getTraits({game,playerId})})) };
  return planWindSequence(own,game.turn.state?.playerId === playerId ? game.turn.state : null,
    {teamStones:game.stoneCounts(player.team).total,...options,
      card:options.card ? {...options.card,...options.card.getTraits?.({game,playerId})} : null});
}
