import { RuleError } from "./errors.js";
import { Timing } from "./timing.js";

export class TurnFlow {
  constructor(game) { this.game = game; this.state = null; this.lastEndedPlayerId = null; }
  repeatLast(playerId) {
    if (this.state || this.game.winner || this.lastEndedPlayerId !== playerId) throw new RuleError("只能重复刚结束的回合");
    this.game.current = playerId;
    this.lastEndedPlayerId = null;
  }
  *start(playerId, options = {}) {
    if (this.state) throw new RuleError("上一回合尚未结束");
    const context = { playerId, skipped: false, route: null, actionType: null, completed: false, activationDone: false, attackCount: 0, pendingActions: [], usedSkills: {}, phase: Timing.TURN_START };
    this.state = context;
    this.game.recordPresentation("turn", { playerId });
    context.phase = Timing.TURN_BEFORE;
    yield* this.game.trigger(Timing.TURN_BEFORE, context, options);
    context.phase = Timing.TURN_START;
    yield* this.game.trigger(Timing.TURN_START, context, options);
    context.phase = Timing.ACTION_PHASE_BEFORE;
    yield* this.game.trigger(Timing.ACTION_PHASE_BEFORE, context, options);
    context.phase = context.skipped ? Timing.ACTION_PHASE_SKIPPED : Timing.ACTION_PHASE_START;
    yield* this.game.trigger(context.phase, context, options);
    return { skipped: context.skipped };
  }
  nextAction() {
    const state = this.state;
    if (!state || !state.completed) return null;
    return [...state.pendingActions].reverse().find(action => action.element) ?? state.pendingActions[0] ?? null;
  }
  hasExtraActions() { return !!this.nextAction(); }
  needsAction() {
    return !!this.state && !this.game.winner && !this.state.skipped && (!this.state.completed || this.hasExtraActions());
  }
  addAttackAction({ element = null, sourceSkillId = null } = {}) {
    if (!this.state) return;
    this.state.pendingActions.push({ type: "attack", element, sourceSkillId });
    this.game.logSkill(this.state.playerId, sourceSkillId ?? "额外行动", `获得1次${element ? "风系限定" : ""}额外攻击行动，可选择放弃`);
    this.game.recordPresentation("extraAction", { playerId: this.state.playerId, label: element ? "额外风系攻击行动" : "额外攻击行动" });
  }
  canUse(type, card = null) {
    const state = this.state;
    if (!state) return true;
    if (state.skipped) return false;
    if (!state.completed) return !state.actionType && (type !== "special" || !state.activationDone);
    const action = this.nextAction();
    return !!action && action.type === type && (!action.element || card?.getTraits({ game: this.game, playerId: state.playerId, purpose: "action" }).elements.includes(action.element));
  }
  *beginAction(playerId, actionType, card = null, options = {}) {
    const state = this.state;
    // Standalone rule operations are allowed in fixtures; normal clients start a turn.
    if (!state) return;
    if (!["attack", "spell", "special"].includes(actionType)) throw new RuleError("未知行动类型");
    if (state.playerId !== playerId || !this.canUse(actionType, card)) throw new RuleError("当前阶段不能执行该行动");
    const route = actionType === "special" ? "special" : "normal";
    if (route === "normal" && !state.activationDone) {
      state.activationDone = true;
      state.phase = Timing.ACTIVATION;
      state.reservedEnergy = options.actionEnergyCost ?? 0;
      state.reservedHealing = options.actionHealingCost ?? 0;
      yield* this.game.trigger(Timing.ACTIVATION, state, options);
      delete state.reservedEnergy;
      delete state.reservedHealing;
    }
    try { options.validateAction?.(); }
    catch (error) { state.phase = Timing.ACTION_PHASE_START; error.actionInvalidated = true; throw error; }
    if (state.completed) {
      const action = this.nextAction(); state.pendingActions.splice(state.pendingActions.indexOf(action), 1);
    }
    state.completed = false;
    if (actionType === "attack") state.attackCount++;
    state.route = route; state.actionType = actionType;
    state.phase = { attack: Timing.ATTACK_ACTION_START, spell: Timing.SPELL_ACTION_START, special: Timing.SPECIAL_ACTION_START }[actionType];
    yield* this.game.trigger(state.phase, state, options);
  }
  *endAction(options = {}) {
    const state = this.state;
    yield* this.game.present();
    if (!state || !state.completed) {
      this.game.recordPresentation("clear");
      yield* this.game.present();
    }
    if (!state || state.completed || !state.actionType) return;
    state.phase = { attack: Timing.ATTACK_ACTION_END, spell: Timing.SPELL_ACTION_END, special: Timing.SPECIAL_ACTION_END }[state.actionType];
    yield* this.game.trigger(state.phase, state, options);
    state.completed = true;
  }
  *end(options = {}) {
    const state = this.state;
    if (!state) throw new RuleError("没有正在进行的回合");
    if (!this.game.winner && !state.skipped && !state.completed) throw new RuleError("必须完成普通行动及其结算后才能结束回合");
    if (this.game.players.some(player => player.pendingOverflow)) throw new RuleError("必须完成强制弃牌后才能结束回合");
    if (!state.skipped) {
      state.phase = Timing.ACTION_PHASE_END;
      yield* this.game.trigger(state.phase, state, options);
    }
    state.phase = Timing.TURN_END;
    yield* this.game.trigger(state.phase, state, options);
    this.lastEndedPlayerId = state.playerId;
    this.game.current = (state.playerId + 1) % this.game.players.length;
    this.state = null;
  }
}
