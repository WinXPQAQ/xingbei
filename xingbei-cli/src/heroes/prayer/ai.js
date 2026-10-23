function supportTargetBonus(state, id, targetId, skillId) {
  const target = state.players[targetId];
  if (target.team !== state.players[id].team) return -1e6;
  const pressure = Math.min(2, target.count / 3);
  const attacker = ["berserker", "windSwordmaster", "marksman", "magicSwordsman", "heroicPuppet", "valkyrie"].includes(target.hero);
  return (skillId === "powerBlessing" ? 5 : 4) + pressure + (attacker ? 3 : 0);
}
const hasBlessing = (card) => ["powerBlessing", "speedBlessing"].some((skill) => card.hasUniqueSkill(skill));

export const prayerAi = {
  id: "prayer",
  sharedDecisionSkills: ["powerBlessing", "speedBlessing"],
  cardBonus({ card, same, player }) {
    if (hasBlessing(card)) return same ? 25 : 43;
    if (card.type === "attack" && (player.hero.state?.prayerRunes ?? 0) < 3) return same ? 4 : 12;
    return 0;
  },
  resourceValue: (p) => p.energy.gem * 5 + p.energy.crystal * 3 + (p.heroState.prayerRunes ?? 0) * 3 + (p.heroState.form ? 4 : 0),
  refineBonus: ({ player, gem, crystal }) => (gem && !player.energy.gem ? 8 : 0) +
    (crystal && !player.energy.crystal && player.heroState.prayerRunes > 0 ? 2 : 0),
  prepareAttack({ player, active }) {
    if (active && player.heroState.form) player.heroState.prayerRunes = Math.min(3, (player.heroState.prayerRunes ?? 0) + 2);
  },
  preparations({ state, id, player, card, options }, { copy, payEnergy }) {
    if (card?.type !== "attack" || player.heroState.form || player.energy.gem <= 0) return options;
    const prepared = copy(state); payEnergy(prepared, id, 1, "gem"); prepared.players[id].heroState.form = "prayer";
    options.push({ state: prepared, activated: "prayer" });
    return options;
  },
  scoreSkill({ game, next, id, source, player, targetId, skillId }, { chooseAiDiscard, spend, cardCost, stones, heal, hurt, terminal }) {
    if (skillId === "radiantFaith") {
      player.heroState.prayerRunes--;
      const discarded = chooseAiDiscard(game, id, Math.min(2, source.hand.length)).map((i) => source.hand[i]);
      spend(next, id, discarded.map((c) => player.hand.find((item) => item.id === c.id)).filter(Boolean), { publicExposure: false });
      stones(next, player.team, "gem", 1); heal(next, targetId, 1);
      return -cardCost(game, id, discarded);
    }
    if (skillId === "darkCurse") {
      if (next.players[targetId].team === player.team) return null;
      player.heroState.prayerRunes--;
      hurt(next, targetId, 2);
      if (!terminal(next)) hurt(next, id, 2);
      return 0;
    }
    if (["powerBlessing", "speedBlessing"].includes(skillId)) return supportTargetBonus(next, id, targetId, skillId);
    return null;
  },
  spellActions({ state, id, player }, { foes }) {
    const actions = [];
    for (const card of player.hand) for (const skillId of ["powerBlessing", "speedBlessing"])
      if (card.uniqueSkills.includes(skillId)) for (const target of state.players.filter((t) => t.team === player.team && t.id !== id && !t.effects.some((e) => e.name === skillId)))
        actions.push({ type: "skill", skillId, cardIds: [card.id], targetIds: [target.id] });
    if (player.heroState.form && player.heroState.prayerRunes > 0) {
      for (const target of foes(state, id)) actions.push({ type: "skill", skillId: "darkCurse", cardIds: [], targetIds: [target.id] });
      for (const target of state.players.filter((t) => t.team === player.team && t.id !== id)) actions.push({ type: "skill", skillId: "radiantFaith", cardIds: [], targetIds: [target.id] });
    }
    return actions;
  },
  skipCounterCard({ game, id, card, request }, { elements }) {
    return hasBlessing(card) && request.valid.some((other) => other.card.type === "attack" && !hasBlessing(other.card) &&
      elements(game, id, other.card).some((element) => elements(game, id, card).includes(element)));
  },
  decisions: {
    prayer({ game, id, state, request }, { activationUseful }) {
      if (request.type === "skillChoice") return activationUseful(game, id, state, request, "prayer");
    },
    manaTide({ game, id, state, request }, { copy, payEnergy, bestSpellFollow, evaluate }) {
      if (request.type !== "skillChoice") return;
      const next = copy(state); payEnergy(next, id);
      return bestSpellFollow(game, id, next) + evaluate(next) - evaluate(state) > 1;
    },
    powerBlessing({ game, id, state, request, context }, { damageGain }) {
      if (request.type !== "skillChoice") return;
      if (context.targetId == null || game.player(id).team === game.player(context.targetId).team) return false;
      return damageGain(state, id, context.targetId, (context.amount ?? 2) + 2, "attack") -
        damageGain(state, id, context.targetId, context.amount ?? 2, "attack") > 1;
    },
    speedBlessing({ game, id, state, request }, { bestAttackScore }) {
      if (request.type === "skillChoice") return bestAttackScore(game, id, state).score > 1;
    },
  },
};
