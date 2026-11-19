// Counterfactual branch control for one focal seat during one turn.
// The driver replays an exact forced prefix (all choices up to and including
// the branched label). This control only finds the next strategic node of the
// focal turn, records its observation and stops the game. Rules and
// candidates are never changed.
//
// Labels are per candidate; several candidates may share one label. For skill
// costs only the decision to stop or add another card is branched.
export function strategicLabels({ request, candidates }) {
  if (request.type !== 'action') return null;
  if (request.stage === 'direction') return candidates.map(candidate => candidate.direction);
  if (request.stage === 'skill') return candidates.map(candidate => 'skill:' + candidate.skillId);
  if (request.stage === 'targets') return candidates.map(candidate =>
    'target:' + (candidate.targetIds ? candidate.targetIds.join(',') : candidate.targetId));
  if (request.stage === 'targetCount') return candidates.map(candidate => 'count:' + candidate.targetCount);
  if (request.stage === 'costCards' && candidates.some(candidate => candidate.complete) && candidates.length > 1)
    return candidates.map(candidate => candidate.complete ? `stop:${candidate.cardIds.length}` : `more:${candidate.cardIds.length}`);
  return null;
}
const distinct = labels => [...new Set(labels)];

export function createBranchControl({ seat, focalTurn, expand = false }) {
  // focalTurn null: stop at the seat's next strategic node in any turn (search).
  if (!Number.isInteger(seat) || (focalTurn != null && !Number.isInteger(focalTurn))) throw new Error('Invalid branch control');
  let status = 'running', labels = null, stage = null, turn = null;
  const stop = reason => {
    status = reason;
    const error = new Error(`Branch stopped: ${reason}`);
    error.branchStop = reason;
    throw error;
  };
  return {
    seat,
    stop,
    step(input) {
      if (!expand || status !== 'running' || (focalTurn != null && input.turn !== focalTurn)) return {};
      if (input.game.turn.state?.playerId !== seat) return {};
      const current = strategicLabels(input);
      if (!current || distinct(current).length < 2) return {};
      labels = current; stage = input.request.stage; turn = input.turn;
      return { record: { labels, stage } };
    },
    info() {
      return { status: status === 'running' ? 'complete' : status, labels, stage, turn };
    },
  };
}
