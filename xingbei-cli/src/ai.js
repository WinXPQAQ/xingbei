/**
 * 第一版 AI：随机选牌，并对少数状态牌使用简单的目标偏好。
 * 本文件只负责决策；合法性和实际结算仍由 Game 负责。
 */
export function chooseAiAction(game, actorId) {
  const player = game.player(actorId);
  if (game.canRefreshUnableHand(actorId)) return { type: "refresh" };

  const stones = game.stoneCounts(player.team);
  if (stones.total >= 3 && game.canDrawSpecial(actorId)) {
    const synthesis = game.synthesisOptions(player.team);
    // 宝石数越少，使用的水晶数越多。
    const gemCount = synthesis.automatic ? synthesis.gemCount : synthesis.choices[0];
    return { type: "synthesize", gemCount };
  }

  const cards = game.legalCards(actorId);
  if (!cards.length) return game.canDrawSpecial(actorId) ? { type: "purchase" } : { type: "pass" };

  const action = randomItem(game, cards);
  let targets = action.targets;

  if (action.card.name === "holyShield") {
    const allies = targets.filter(id => game.player(id).team === player.team);
    if (allies.length) targets = allies;
  } else if (action.card.name === "weakness" || action.card.name === "poison") {
    const enemies = targets.filter(id => game.player(id).team !== player.team);
    if (enemies.length) {
      const highestHandSize = Math.max(...enemies.map(id => game.player(id).hand.length));
      targets = enemies.filter(id => game.player(id).hand.length === highestHandSize);
    }
  }

  return { type: "play", index: action.index, targetId: randomItem(game, targets) };
}

export function runAiAction(game, actorId, { autoRespond = true } = {}) {
  const action = chooseAiAction(game, actorId);
  if (action.type === "refresh") game.refreshUnableHand(actorId);
  else if (action.type === "purchase") game.purchase(actorId);
  else if (action.type === "synthesize") game.synthesize(actorId, action.gemCount);
  else if (action.type === "play") game.play(actorId, action.index, action.targetId, { autoRespond });
  else game.log.push(`${game.player(actorId).name}跳过行动`);
  return action;
}

function randomItem(game, items) {
  return items[Math.floor(game.random() * items.length)];
}

export function chooseAiResponse(game, context) {
  if (!context.valid.length) return null;
  const picked = randomItem(game, context.valid);
  if (!picked) return null;
  const targetId = picked.card.type === "attack" ? randomItem(game, context.counterTargets).id : context.nextTarget?.id ?? null;
  return { index: picked.index, targetId };
}
