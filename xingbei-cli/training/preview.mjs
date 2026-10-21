// Bounded semantic projections from the SAME detached observation as the model.
// Never receives Game, hidden cards, a random generator, or a heuristic score.
// These are local operation checkpoints, not complete resolution predictions.
export function enrichPreview(observation) {
  const own = observation.players[0];
  const remove = cards => {
    const remaining = [...own.hand];
    for (const selected of cards) {
      const index = remaining.findIndex(card => JSON.stringify(card) === JSON.stringify(selected));
      if (index < 0) throw new Error('Preview selected card is not in observed hand');
      remaining.splice(index, 1);
    }
    return { remainingHand: remaining, handCountAfter: remaining.length,
      remainingUniqueSkills: remaining.flatMap(card => card.uniqueSkills) };
  };
  observation.candidates = observation.candidates.map(candidate => {
    let preview = { version: 1, scope: 'unresolved', stop: 'rule-resolution' };
    if (observation.request.type === 'overflow') {
      preview = { version: 1, scope: 'local-operation', ...remove(candidate.cards),
        discardVisibility: 'hidden', stop: 'morale-and-following-triggers' };
    } else if (observation.request.type === 'response' && candidate.type === 'response') {
      preview = { version: 1, scope: 'local-operation', ...remove([candidate.card]),
        playedZone: 'field', stop: 'card-exposure-and-following-triggers' };
      // This describes the rule branch, NOT a resolved hit/damage/win outcome.
      preview.responseBranch = candidate.card.name === 'holyLight' ? 'cancel'
        : candidate.card.name === 'magicBullet' ? 'relay' : 'counterattack';
    } else if (observation.request.type === 'action' && candidate.type === 'refine') {
      const { gem, crystal } = candidate.stones;
      preview = { version: 1, scope: 'local-operation', stop: 'action-end-triggers',
        energyAfter: { gem: own.energy.gem + gem, crystal: own.energy.crystal + crystal },
        teamStonesAfter: { gem: observation.teams.own.achievements.filter(stone => stone === 'gem').length - gem, crystal: observation.teams.own.achievements.filter(stone => stone === 'crystal').length - crystal } };
    } else if (observation.request.type === 'action' && candidate.type === 'pass') {
      preview = { version: 1, scope: 'local-operation', pendingActionsAfter: [], stop: 'turn-end-triggers' };
    }
    return { ...candidate, preview };
  });
  return observation;
}
