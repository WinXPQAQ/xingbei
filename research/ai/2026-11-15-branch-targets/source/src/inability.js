import { combinations } from './card-sets.js';

export function actionRequired(game, playerId) {
  const s=game.turn.state;
  return !!s && s.playerId===playerId && s.activationDone && !s.completed && !s.skipped && !s.actionType && !game.winner;
}
// A read-only projection: no zone movement, trigger, payment or random draw.
export function canContinueWithHand(game, playerId, hand, { energy, healing, afterActivation = false } = {}) {
  const view=Object.create(game), player=Object.create(game.player(playerId));
  player.hand=hand;
  if (energy) player.energy={...energy};
  if (healing !== undefined) player.healing=healing;
  view.players=game.players.map(p=>p.id===playerId?player:p);
  view.turn=Object.create(game.turn);view.turn.game=view;
  if (afterActivation && game.turn.state) view.turn.state={...game.turn.state,activationDone:true,route:'normal'};
  return view.legalCards(playerId).length>0 || view.legalSkillActions(playerId).length>0;
}

// One crystal-equivalent followed by removing one hand card. Check each actual
// payment: spending the gem instead can remove a gem-only continuation.
// This is a deterministic projection, not a simulation of draws or triggers.
export function safePaidRemovalChoices(game, playerId, { healingGain = 0 } = {}) {
  const player=game.player(playerId);
  const blocked=game.players.some(owner=>owner.hero.blocksHealing?.({game,player:owner,targetId:playerId}));
  const healing=player.healing+(blocked?0:Math.max(0,Math.min(healingGain,game.getHealingLimit(playerId)-player.healing)));
  return [{gem:0,crystal:1},{gem:1,crystal:0}].flatMap(payment=>{
    const energy={gem:player.energy.gem-payment.gem,crystal:player.energy.crystal-payment.crystal};
    if(energy.gem<0 || energy.crystal<0)return [];
    const cards=player.hand.filter(card=>canContinueWithHand(game,playerId,player.hand.filter(c=>c!==card),{energy,healing,afterActivation:true}));
    return cards.length?[{payment,cards}]:[];
  });
}
export function safeRemovalSets(game, playerId, count, valid) {
  const p=game.player(playerId), sets=combinations(valid??p.hand.map((_,i)=>i),count);
  if (!actionRequired(game,playerId))return sets;
  return sets.filter(set=>canContinueWithHand(game,playerId,p.hand.filter((_,i)=>!set.includes(i))));
}

// Overflow is selected incrementally by clients and the network. Search for a
// legal completion lazily instead of materializing every discard combination.
export function overflowChoices(game, playerId) {
  const player = game.player(playerId);
  const valid = player.hand.map((_, index) => index);
  const count = Math.max(0, player.hand.length - player.handLimit);
  const unrestricted = selected => selected.length <= count &&
    new Set(selected).size === selected.length && selected.every(index => valid.includes(index));
  const complete = selected => {
    if (!unrestricted(selected)) return null;
    const remaining = valid.filter(index => !selected.includes(index));
    const visit = (offset, picked) => {
      if (picked.length === count) {
        const hand = player.hand.filter((_, index) => !picked.includes(index));
        return canContinueWithHand(game, playerId, hand) ? picked : null;
      }
      for (let i = offset; i <= remaining.length - (count - picked.length); i++) {
        const found = visit(i + 1, [...picked, remaining[i]]);
        if (found) return found;
      }
      return null;
    };
    return visit(0, selected);
  };
  // If the random draw provided no actionable retention, keep the existing
  // forced-refresh procedure. A completed action has no continuation obligation.
  const required = count > 0 && actionRequired(game, playerId);
  const safeDefault = required ? complete([]) : null;
  const cache = new Map();
  const canSelect = selected => {
    if (!safeDefault) return unrestricted(selected);
    const key = [...selected].sort((a, b) => a - b).join(',');
    if (!cache.has(key)) cache.set(key, complete(selected) !== null);
    return cache.get(key);
  };
  return { count, valid, canSelect };
}

export function legalOverflowDiscard(game, playerId, preferred) {
  const choices = overflowChoices(game, playerId);
  if (choices.canSelect(preferred) && preferred.length === choices.count) return preferred;
  const selected = [];
  for (const index of [...new Set([...preferred, ...choices.valid])]) {
    if (selected.length === choices.count) break;
    if (choices.canSelect([...selected, index])) selected.push(index);
  }
  return selected;
}
// Foreign hidden faces are never inspected to prohibit an opponent's choice.
// Only a publicly certain loss of the whole hand is inferred here.
export function knownRemovalBlocked(game, actorId, targetId, count) {
  if (!actionRequired(game,targetId))return false;
  const player=game.player(targetId);
  if(actorId!==targetId && count<player.hand.length)return false;
  if(actorId===targetId)return safeRemovalSets(game,targetId,Math.min(count,player.hand.length)).length===0;
  return !canContinueWithHand(game,targetId,[]);
}

// Only use for a known deterministic energy-only adjustment, not skills which
// subsequently draw cards or grant actions. The query cannot inspect the deck.
export function canContinueAfterEnergy(game, playerId, kind, count = 1) {
  const view=Object.create(game), player=Object.create(game.player(playerId));
  player.energy={...player.energy};
  const crystals=kind==='gem'?0:Math.min(count,player.energy.crystal);
  player.energy.crystal-=crystals;player.energy.gem-=count-crystals;
  view.players=game.players.map(p=>p.id===playerId?player:p);
  view.turn=Object.create(game.turn);view.turn.game=view;
  return view.legalCards(playerId).length>0 || view.legalSkillActions(playerId).length>0;
}
