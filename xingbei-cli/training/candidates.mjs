// Rule-only enumeration. No policy import, score, top-k pruning, or fallback.
export function combinations(items, count) {
  if (count === 0) return [[]];
  if (count < 0 || count > items.length) return [];
  return items.flatMap((item, i) => combinations(items.slice(i + 1), count - 1).map(rest => [item, ...rest]));
}

export function actionCandidates(game, playerId) {
  if (game.winner) return [];
  const state = game.turn.state;
  if (!state || state.playerId !== playerId || !game.turn.needsAction()) throw new Error('Action requested outside active action phase');
  const player = game.player(playerId), actions = [];
  if (state.completed) actions.push({ type: 'pass' });
  // Refresh and refinement may BOTH be legal. Do not use the old policy's
  // early refresh return: deciding between them is part of the learned policy.
  if (game.canRefreshUnableHand(playerId)) actions.push({ type: 'refresh' });
  for (const { index, targets } of game.legalCards(playerId)) {
    for (const targetId of targets) actions.push({ type: 'play', index, targetId });
  }
  for (const entry of game.legalSkillActions(playerId)) {
    for (const mode of entry.spec.modes?.map(item => item.value) ?? [undefined]) {
      const spec = game.skillActionSpec(playerId, { skillId: entry.skillId, mode });
      if (!spec) continue;
      const costs = combinations(player.hand.filter(spec.cardFilter ?? (() => true)), spec.cardCount ?? 0);
      for (const cards of costs) for (const count of spec.targetCounts ?? [spec.targetCount ?? 1]) {
        for (const targetIds of combinations(spec.targets, count)) {
          actions.push({ type: 'skill', skillId: entry.skillId, ...(mode === undefined ? {} : { mode }), cardIds: cards.map(card => card.id), targetIds });
        }
      }
    }
  }
  const stones = game.stoneCounts(player.team);
  if (game.canDrawSpecial(playerId)) {
    actions.push({ type: 'purchase' });
    for (const gemCount of game.synthesisOptions(player.team).choices) actions.push({ type: 'synthesize', gemCount });
  }
  if (game.canRefine(playerId)) {
    for (let gem = 0; gem <= Math.min(2, stones.gem); gem++) {
      for (let crystal = 0; crystal <= Math.min(2, stones.crystal); crystal++) {
        const count = gem + crystal;
        if (count >= 1 && count <= 2 && count + player.energy.gem + player.energy.crystal <= 3) actions.push({ type: 'refine', stones: { gem, crystal } });
      }
    }
  }
  if (!actions.length) throw new Error(`No legal action for player ${playerId}`);
  return actions;
}

export function decisionPlayer(request) {
  const id = request.type === 'response' ? request.target.id
    : request.type === 'target' ? request.actor.id : request.playerId ?? request.player?.id;
  if (!Number.isInteger(id)) throw new Error(`Missing player for ${request.type}`);
  return id;
}

// Values are engine commands, NOT model input. Card indices/IDs are converted
// to semantic features by the observation encoder before crossing that boundary.
export function decisionCandidates(game, request) {
  if (request.type === 'response') {
    const choices = [null];
    for (const { index } of request.valid) {
      const card = request.target.hand[index];
      if (card.type === 'attack') {
        for (const target of request.counterTargets ?? []) choices.push({ index, targetId: target.id });
      } else choices.push({ index, targetId: card.name === 'magicBullet' ? request.nextTarget?.id ?? null : null });
    }
    return choices;
  }
  if (request.type === 'target') return request.targets.map(target => target.id);
  if (request.type === 'overflow') {
    const player = game.player(decisionPlayer(request));
    return combinations(player.hand.map((_, index) => index), Math.max(0, player.hand.length - player.handLimit));
  }
  if (request.type === 'cardChoice') return [...(request.optional ? [null] : []), ...combinations(request.valid, request.count)];
  if (request.type === 'weakness') return ['draw', 'skip'];
  if (['skillChoice', 'playerChoice', 'effectChoice', 'numberChoice', 'energyChoice', 'healing', 'bindingChoice'].includes(request.type)) {
    if (!request.choices?.length) throw new Error(`Empty ${request.type}`);
    return request.choices.map(choice => choice.value);
  }
  throw new Error(`Unsupported training decision: ${request.type}`);
}
