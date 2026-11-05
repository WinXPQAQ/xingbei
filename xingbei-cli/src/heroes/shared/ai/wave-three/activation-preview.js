import { describeActivationInteractions } from "../../../../ai/activation-interactions.js";
import { damageHealing } from "../wave-two/healing.js";
import { copy, evaluate, terminal, applyActualDamage } from "./model.js";

// Bounded, equal-weight scenarios are a heuristic, NOT response probabilities.
// Undeclared triggers and private cocoon-dependent chains remain explicit gaps.
export function previewActivationDamage(state, event) {
  const target = state.players[event.targetId];
  const maxHealing = target.healingDisabled ? 0 : damageHealing(target, event.amount, event.damageType);
  const amounts = event.targetId === state.observer
    ? Array.from({ length: maxHealing + 1 }, (_, i) => i)
    : [Math.min(maxHealing, Math.max(0, target.count + event.amount - target.limit))];
  const description = describeActivationInteractions(state, event.sourceId);
  const reactions = description.interactions.filter((reaction) => reaction.modeled);
  let best = null;
  for (const healing of amounts) {
    const initial = copy(state);
    initial.players[event.targetId].healing -= healing;
    const actual = Math.max(0, event.amount - healing - (target.hero === "bard" && target.heroState.form === "eternalPrisoner" && event.damageType === "spell" ? 1 : 0));
    let scenarios = [{ state: initial, actual, responses: [] }];
    for (const reaction of reactions) {
      const expanded = [];
      for (const scenario of scenarios) {
        expanded.push(scenario);
        const owner = scenario.state.players[reaction.ownerId];
        if (scenario.actual !== reaction.whenActual || owner.coveredCount < reaction.coveredCost || expanded.length >= 8) continue;
        const next = copy(scenario.state);
        next.players[owner.id].coveredCount -= reaction.coveredCost;
        expanded.push({ state: next, actual: scenario.actual + reaction.actualDelta, responses: [...scenario.responses, reaction.skillId] });
      }
      scenarios = expanded;
    }
    for (const scenario of scenarios) {
      if (!terminal(scenario.state)) applyActualDamage(scenario.state, event.targetId, scenario.actual, event.damageType);
    }
    const scores = scenarios.map((scenario) => evaluate(scenario.state));
    const score = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    if (!best || score > best.score) best = { score, scenarios, scores, actual, healing };
  }
  const { scenarios, scores } = best;
  return {
    state: scenarios[0].state,
    branches: scenarios.map((scenario) => ({ ...scenario, probability: 1 / scenarios.length })),
    preview: {
      ...description, weighting: "equal-scenarios-heuristic", healing: best.healing,
      baselineActual: best.actual, actualRange: [Math.min(...scenarios.map(s => s.actual)), Math.max(...scenarios.map(s => s.actual))],
      baselineValue: scores[0], valueRange: [Math.min(...scores), Math.max(...scores)],
      unresolved: description.interactions.filter((reaction) => !reaction.modeled),
    },
  };
}
