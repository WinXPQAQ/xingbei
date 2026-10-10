import { resolveSync } from "./resolution/decisions.js";
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

  if (game.canRefine(actorId) && game.random() < 0.4) {
    const count = Math.min(2, stones.total, 3 - player.energy.gem - player.energy.crystal);
    const gem = player.hero.id === "berserker" ? Math.min(count, stones.gem) : Math.max(0, count - stones.crystal);
    return { type: "refine", stones: { gem, crystal: count - gem } };
  }
  const skills = game.legalSkillActions(actorId);
  if (skills.length && (!game.legalCards(actorId).length || game.random() < 0.5)) {
    const entry = randomItem(game, skills);
    const mode = entry.spec.modes?.find(choice => choice.value === (player.healing >= 4 ? "damage" : "heal"))?.value ?? entry.spec.modes?.[0].value;
    const spec = game.skillActionSpec(actorId, { skillId: entry.skillId, mode });
    const cards = player.hand.filter(spec.cardFilter ?? (() => true)).slice(0, spec.cardCount ?? 0);
    const preferred = spec.targets.filter(id => game.player(id).team !== player.team);
    const targets = [...(preferred.length >= (spec.targetCount ?? 1) ? preferred : spec.targets)];
    const targetIds = [];
    while (targetIds.length < (spec.targetCount ?? 1)) targetIds.push(targets.splice(Math.floor(game.random() * targets.length), 1)[0]);
    return { type: "skill", skillId: entry.skillId, mode, cardIds: cards.map(card => card.id), targetIds };
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
  else if (action.type === "refine") game.refine(actorId, action.stones);
  else if (action.type === "synthesize") game.synthesize(actorId, action.gemCount);
  else if (action.type === "skill") {
    resolveSync(game.skillActionSteps(actorId, action, { autoRespond }), request => game.automaticDecision(request, { autoRespond }));
  }
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

export function chooseAiRuleDecision(request) {
  if (request.type === "healing") return request.choices.at(-1).value;
  if (request.type === "cardChoice") return request.valid.slice(0, request.count);
  if (request.type === "numberChoice" && request.skillId === "divineShelter") return request.choices.at(-1).value;
  if (request.type === "skillChoice") return request.skillId !== "holyContract" || request.energy.gem + request.energy.crystal > request.reservedEnergy;
  return request.defaultValue ?? null;
}
