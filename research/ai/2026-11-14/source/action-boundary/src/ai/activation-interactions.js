import { heroAi } from "../heroes/shared/ai/wave-three/registry.js";

// This contract describes opportunities, not the result of executing triggers.
// Only public scalar state is copied, including when the caller owns a live Game.
export function describeActivationInteractions(source, actorId, intent = null) {
  const players = source.players.map((player) => {
    const hero = typeof player.hero === "string" ? player.hero : player.hero.id;
    const state = player.heroState ?? player.hero.state;
    return {
      id: player.id, team: player.team, hero,
      heroState: Object.fromEntries((heroAi(hero).activationStateFields ?? []).map(key => [key, state?.[key]])),
      coveredCount: player.coveredCount ?? player.covered?.length ?? 0,
      skillIds: player.skillIds ?? (player.getSkills?.() ?? []).map(({ skill }) => typeof skill === "string" ? skill : skill.id),
    };
  });
  const actor = players.find((player) => player.id === actorId);
  const events = actor ? heroAi(actor.hero).activationEvents?.({ player: actor, id: actorId, intent }) ?? [] : [];
  const interactions = events.flatMap((event, eventIndex) => players.flatMap((player) =>
    (heroAi(player.hero).activationReactions?.({ player, event }) ?? []).map((reaction) => ({
      ...reaction, eventIndex, ownerId: player.id, targetId: event.targetId,
      optional: true, probability: null,
    }))));
  return { schemaVersion: 1, coverage: "declared-effects-only", events, interactions };
}
