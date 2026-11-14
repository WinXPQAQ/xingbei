// Explicit experimental controls. They never change the engine's legal moves.
export function firstSageRefinement(input, state) {
  const { game, playerId, request, candidates } = input;
  const player = game.player(playerId);
  if (state.refined || player.hero.id !== 'sage' || request.type !== 'action' ||
      player.energy.gem + player.energy.crystal !== 0 || !game.canRefine(playerId) ||
      game.getEnergyLimit(playerId) < 2 || game.stoneCounts(player.team).gem < 2) return null;
  const index = candidates.findIndex(candidate => candidate.direction === 'refine' ||
    candidate.type === 'refine' && candidate.stones.gem === 2 && candidate.stones.crystal === 0);
  if (index < 0) return null;
  if (candidates[index].type === 'refine') state.refined = true;
  state.decisions++;
  return index;
}

export function removeExerciseObjective(observation) {
  const question = observation.entities[observation.question];
  delete question.categorical.objective;
  for (const key of ['initialGems', 'gemRetentionBonus', 'rewardScale', 'maxOwnMoraleLoss', 'ownMoraleLossSoFar']) {
    delete question.numbers[key];
  }
  return observation;
}
