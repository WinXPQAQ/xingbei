import { RuleError } from "./errors.js";
import { Timing } from "./timing.js";

export class TurnFlow {
  constructor(game) { this.game = game; this.state = null; }
  *start(playerId, options = {}) {
    if (this.state) throw new RuleError("上一回合尚未结束");
    const context = { playerId, skipped: false, route: null, actionType: null, completed: false, phase: Timing.TURN_START };
    this.state = context;
    yield* this.game.trigger(Timing.TURN_START, context, options);
    context.phase = Timing.ACTION_PHASE_BEFORE;
    yield* this.game.trigger(Timing.ACTION_PHASE_BEFORE, context, options);
    context.phase = context.skipped ? Timing.ACTION_PHASE_SKIPPED : Timing.ACTION_PHASE_START;
    yield* this.game.trigger(context.phase, context, options);
    return { skipped: context.skipped };
  }
  *beginAction(playerId, actionType) {
    const state = this.state;
    // Standalone rule operations are allowed in fixtures; normal clients start a turn.
    if (!state) return;
    if (!["attack", "spell", "special"].includes(actionType)) throw new RuleError("未知行动类型");
    if (state.playerId !== playerId || state.skipped || state.actionType || state.completed) throw new RuleError("当前阶段不能执行该行动");
    state.route = actionType === "special" ? "special" : "normal";
    state.actionType = actionType;
    if (state.route === "normal") {
      state.phase = Timing.ACTIVATION;
      yield* this.game.trigger(Timing.ACTIVATION, state);
    }
    state.phase = { attack: Timing.ATTACK_ACTION_START, spell: Timing.SPELL_ACTION_START, special: Timing.SPECIAL_ACTION_START }[actionType];
    yield* this.game.trigger(state.phase, state);
  }
  *endAction() {
    const state = this.state;
    if (!state || state.completed || !state.actionType) return;
    state.phase = { attack: Timing.ATTACK_ACTION_END, spell: Timing.SPELL_ACTION_END, special: Timing.SPECIAL_ACTION_END }[state.actionType];
    yield* this.game.trigger(state.phase, state);
    state.completed = true;
  }
  *end() {
    const state = this.state;
    if (!state) throw new RuleError("没有正在进行的回合");
    yield* this.endAction();
    if (!state.skipped) {
      state.phase = Timing.ACTION_PHASE_END;
      yield* this.game.trigger(state.phase, state);
    }
    state.phase = Timing.TURN_END;
    yield* this.game.trigger(state.phase, state);
    this.game.current = (state.playerId + 1) % this.game.players.length;
    this.state = null;
  }
}
