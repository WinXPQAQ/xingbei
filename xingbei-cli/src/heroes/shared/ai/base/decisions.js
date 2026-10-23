import { aiForSkill } from "./registry.js";

// Choices not covered by the state-value search retain their existing legal
// baseline behavior. Hero-specific choices are kept beside that hero's rules.
export function chooseAiRuleDecision(request, game) {
  if (!game) return request.defaultValue ?? null;
  const player = game.player(request.playerId ?? request.player?.id);
  const result = aiForSkill(request.skillId).fallback?.({ request, game, player });
  if (result !== undefined) return result;
  if (request.type === "playerChoice") {
    const friendly = request.choices.filter(choice => game.player(choice.value).team === player.team);
    return [...(friendly.length ? friendly : request.choices)].sort((a, b) => {
      const score = id => {
        const target = game.player(id);
        return Math.max(0, game.getHealingLimit(id) - target.healing) * 10 + target.hand.length;
      };
      return score(b.value) - score(a.value);
    })[0].value;
  }
  if (request.type === "skillChoice") return false;
  return request.defaultValue ?? null;
}
