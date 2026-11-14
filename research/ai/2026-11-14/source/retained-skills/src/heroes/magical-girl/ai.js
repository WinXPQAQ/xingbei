import { clone, value, damage, spend, stones } from "../shared/ai/base/model.js";
import { retentionBonus } from "../shared/ai/wave-two/cards.js";
import { gemPreparation } from "../shared/ai/wave-two/energy.js";

function scoreSkill({ game: g, id, action, state }) {
  const actor = state.players[id];
  let bonus = 0;
  if (action.skillId === "magicBurst") {
    stones(state, g.player(id).team, "gem", 1);
    // Opponent spells are hidden; compare discard and damage without their cards.
    for (const target of action.targetIds ?? []) {
      const hit = clone(state), refuse = clone(state);
      damage(hit, target, 2, "spell");
      refuse.players[target].count = Math.max(0, refuse.players[target].count - 1);
      bonus += 0.55 * (value(hit) - value(state)) + 0.45 * (value(refuse) - value(state));
    }
    bonus += 3;
    bonus -= Math.min(actor.count, 2) * 1.5;
  }
  if (action.skillId === "destructionStorm") for (const target of action.targetIds ?? []) damage(state, target, 2, "spell");
  return { bonus };
}
// Any defending hero may receive this choice; keep the skill's comparison here.
export function magicBurstDiscard(request, g, state, indexes) {
  if (!request.optional || request.skillId !== "magicBurst") return indexes;
  const id = request.playerId ?? request.player?.id, player = g.player(id), discard = clone(state), hit = clone(state);
  spend(discard, id, indexes.map((index) => state.players[id].hand[index]));
  damage(hit, id, 2, "spell");
  return value(hit) >= value(discard) - indexes.reduce((n, index) => n + retentionBonus(g, id, player.hand[index]), 0) ? null : indexes;
}
export const magicalGirlAi = {
  scoreSkill,
  retentionBonus: (g, id, card) => card.type === "spell" ? 3 : 0,
  acceptsCrystalRefinement: () => false,
  refinementAdjustment: gemPreparation,
};
