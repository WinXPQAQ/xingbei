import { RuleError } from "../../errors.js";
import { Timing } from "../../timing.js";
import { discardHand } from "./covered.js";

// Visibility is scoped to this decision, never a public reveal or a global hand lookup.
export function* chooseVisibleCard(
  game,
  playerId,
  cards,
  skillId,
  title,
  optional = false,
) {
  const choices = cards.map((c) => ({
    value: c.id,
    label: game.describeCards([c], playerId),
  }));
  if (optional) choices.unshift({ value: null, label: "不发动" });
  if (!choices.length) return null;
  const id = yield {
    type: "effectChoice",
    playerId,
    skillId,
    title,
    choices,
    revealedCards: cards,
    optional,
    defaultValue: choices[0].value,
  };
  if (!choices.some((c) => c.value === id))
    throw new RuleError("无效的可见牌选择");
  return id == null ? null : cards.find((c) => c.id === id);
}
export function* adjustHand(game, playerId, count, skillId, options) {
  const p = game.player(playerId);
  if (p.hand.length > count)
    yield* discardHand(game, playerId, p.hand.length - count, skillId, options);
  else
    yield* game.drawSteps(playerId, count - p.hand.length, {
      ...options,
      cause: { type: "directDraw", skillId },
    });
}
export function* gainCard(game, playerId, card, skillId, options) {
  if (!card) return;
  game.logSkill(
    playerId,
    skillId,
    `获得${game.describeCards([card], playerId, { hidden: card.coveredVisibility !== "public" && card.discardVisibility !== "public" })}`,
  );
  game.moveCard(card.id, { zone: "hand", playerId });
  yield* game.drawSteps(playerId, 0, {
    ...options,
    cause: { type: "directDraw", skillId },
  });
}
// An inserted action must finish its own start/end events before the suspended
// skill continues. It shares the turn's counters, but not the outer action frame.
export function* insertedAction(
  game,
  playerId,
  sourceSkillId,
  resolve,
  options = {},
) {
  const outer = game.turn.state;
  const frame = {
    ...outer,
    playerId,
    skipped: false,
    completed: false,
    activationDone: true,
    actionType: null,
    actionSourceSkillId: sourceSkillId,
    attackCount: outer?.attackCount ?? 0,
    pendingActions: [],
    usedSkills: outer?.usedSkills ?? {},
    phase: Timing.ACTION_PHASE_START,
  };
  game.turn.state = frame;
  try {
    yield* resolve();
  } finally {
    game.turn.state = outer;
    if (outer) {
      outer.attackCount = frame.attackCount;
      outer.pendingActions.push(...frame.pendingActions);
    }
  }
}
