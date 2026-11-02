export const azureFlameWitchAi = {
  id: 'azureFlameWitch',
  cardBonus: ({ card, elements, retained }) => elements.includes('fire') ? 18 :
    card.type === 'spell' && retained.filter(c => c.type === 'spell').length < 2 ? 12 : 0,
  resourceValue: p => (p.heroState.rebirth ?? 0) * 3 + p.energy.crystal * 2,
  scoreSkill({ next, id, targetId, skillId, player }, { hurt, discardEstimate }) {
    const amounts = { azureCodex: 2, skyfireRift: 3, painLink: 1 };
    if (!(skillId in amounts)) return null;
    let amount = amounts[skillId];
    if (skillId === 'skyfireRift') {
      if (!player.heroState.form) player.heroState.rebirth--;
      if (next.teams[player.team].morale < next.teams[next.players[targetId].team].morale) amount++;
    }
    hurt(next, targetId, amount); hurt(next, id, amount);
    if (skillId === 'painLink') discardEstimate(next, id, Math.max(0, player.count - 3));
    return 0;
  },
  decisions: {
    witchWrath({ request, player, source }) {
      if (request.type === 'skillChoice') return (player.heroState.rebirth ?? 0) >= 2 &&
        source.hand.some(c => c.type === 'attack' && !['water','dark'].includes(c.element));
      return Math.min(2, Math.max(0, player.limit - player.count));
    },
    substituteDoll({ request, state, player, game, id }, { cardCost }) {
      const allies = state.players.filter(p => p.team === player.team && p.id !== id && p.count < p.limit);
      if (request.type === 'playerChoice') return allies.sort((a,b) => a.count - b.count)[0]?.id ?? request.defaultValue;
      if (!allies.length) return null;
      const sorted = [...request.valid].sort((a,b) => cardCost(game,id,[game.player(id).hand[a]]) - cardCost(game,id,[game.player(id).hand[b]]));
      return sorted.length ? [sorted[0]] : null;
    },
    manaInversion({ request, game, id, state, player }, { cardCost, damageGain }) {
      const enemies = state.players.filter(p => p.team !== player.team);
      if (request.type === 'playerChoice') return enemies.sort((a,b) => damageGain(state,id,b.id,1)-damageGain(state,id,a.id,1))[0].id;
      let best = { indexes: null, score: 0 };
      for (const indexes of request.validSets ?? []) {
        const score = Math.max(...enemies.map(p => damageGain(state,id,p.id,indexes.length-1))) - cardCost(game,id,indexes.map(i=>game.player(id).hand[i])) - 3;
        if (score > best.score) best = { indexes, score };
      }
      return best.indexes;
    },
  },
};
