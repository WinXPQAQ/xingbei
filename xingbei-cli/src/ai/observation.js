// Trusted adapter: only this function receives Game. The policy receives a detached
// whitelist of legal observations, never a proxy, live entity, or engine callback.
const pick = (value, keys) => Object.fromEntries(keys.filter(k => value?.[k] !== undefined).map(k => [k, value[k]]));
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
export function captureObservation(game, observerId, { actions = false, history = true, activation = false } = {}) {
  const visible = [...game.player(observerId).hand, ...game.players.flatMap(p => p.statuses), ...game.field];
  const cards = [...new Map(visible.map(c => [c.id, c])).values()].map(c => ({
    id: c.id, name: c.name, type: c.type, category: c.category, elements: [...c.elements], fates: [...c.fates],
    uniqueSkills: [...c.uniqueSkills], location: copy(c.location), attachment: c.attachment ? { effectId: c.attachment.effectId } : null,
    traits: Object.fromEntries(game.players.map(p => [p.id, copy(c.getTraits({ game, playerId: p.id }))])),
  }));
  const specData = spec => ({ ...copy(pick(spec, ['type','cardCount','targets','targetCount','targetCounts','energy','healingCost','modes'])),
    allowedCardIds: game.player(observerId).hand.filter(spec.cardFilter ?? (() => true)).map(c => c.id) });
  const skills = actions ? game.legalSkillActions(observerId).map(entry => ({ skillId: entry.skillId, spec: specData(entry.spec),
    modes: (entry.spec.modes?.map(c => c.value) ?? [null]).map(mode => ({ mode, spec: specData(game.skillActionSpec(observerId, { skillId: entry.skillId, mode: mode ?? undefined })) })) })) : [];
  return copy({ observerId, current: game.current, cards,
    players: game.players.map(p => ({ id: p.id, name: p.name, team: p.team, handLimit: p.handLimit, healing: p.healing, energy: pick(p.energy,['gem','crystal']),
      hero: { id: p.hero.id, ...(['saint','holyLancer','plagueMage','elementalist','valkyrie','magicalGirl'].includes(p.hero.id) ? {state: pick(p.hero.state,['elements','form','compassion'])} : {}), skills: p.hero.skills.map(s => typeof s === 'string' ? s : s.id) },
      skillIds: p.getSkills().map(({skill}) => typeof skill === 'string' ? skill : skill.id),
      handIds: p.id === observerId ? p.hand.map(c => c.id) : null, handCount: p.hand.length,
      statusIds: p.statuses.map(c => c.id), healingLimit: game.getHealingLimit(p.id) })),
    teams: Object.fromEntries(Object.entries(game.teams).map(([id,t]) => [id,pick(t,['morale','cups','gem','crystal','achievements'])])), turn: game.turn.state ? pick(game.turn.state,['playerId','completed','attackCount','pendingActions','usedSkills',...(activation&&game.turn.state.playerId===observerId?['activationDone','reservedEnergy','reservedHealing']:[])]) : null, hasExtraActions: game.turn.hasExtraActions?.() ?? false,
    effects: [...game.effects].map(([id, effect]) => [id, { isSeal: !!effect.isSeal }]),
    publicHistory: history && game.publicHistory ? { sequence: game.publicHistory.sequence, ...(game.publicHistory.actions ? {actions: game.publicHistory.actions.map(e=>pick(e,['type','team','playerId','actorId','sourceId','targetId','card','elements','fates','uniqueSkills','counter','result','amount','skillId','accepted','count','sequence','effectId','gem','crystal']))} : {}), events: game.publicHistory.events.map(e => pick(e,['type','playerId','elements','sequence','acceptCost'])) } : null,
    skills, legal: actions ? game.legalCards(observerId).map(e => ({ index: e.index, cardId: e.card.id, targets: e.targets })) : [],
    refresh: actions && game.canRefreshUnableHand(observerId), draw: actions && game.canDrawSpecial(observerId), refine: actions && game.canRefine(observerId),
    stones: Object.fromEntries(Object.keys(game.teams).map(team => [team, game.stoneCounts(team)])),
    synthesis: actions ? Object.fromEntries(Object.keys(game.teams).map(team => [team, game.synthesisOptions(team)])) : {},
  });
}
// Functions below close only over detached observation data. Reflection cannot
// recover hidden cards because they were never passed across this boundary.
export function observationView(data) {
  const d = copy(data), cards = new Map(d.cards.map(c => [c.id, { ...c,
    hasUniqueSkill: id => c.uniqueSkills.includes(id), getTraits: ({playerId}) => copy(c.traits[playerId]),
  }]));
  const players = d.players.map(p => ({ ...p, hand: p.handIds ? p.handIds.map(id => cards.get(id)) : Object.freeze({ length: p.handCount }),
    statuses: p.statusIds.map(id => cards.get(id)), getSkills: () => p.skillIds.map(id => ({skill: {id}})),
    getStatus: id => p.statusIds.map(id => cards.get(id)).filter(c => c.attachment?.effectId === id),
    getBasicEffects: () => p.statusIds.map(id => cards.get(id)).filter(c => c.category === 'basic'),
  }));
  const spec = s => ({ ...s, cardFilter: card => s.allowedCardIds.includes(card.id) });
  return { players, player: id => players[id], cards, teams: d.teams, current: d.current, effects: new Map(d.effects), publicHistory: d.publicHistory,
    turn: { state: d.turn, hasExtraActions: () => d.hasExtraActions },
    legalCards: () => d.legal.map(e => ({ ...e, card: cards.get(e.cardId) })),
    legalSkillActions: () => d.skills.map(e => ({ ...e, spec: spec(e.spec) })),
    skillActionSpec: (id, action) => spec(d.skills.find(e => e.skillId === action.skillId).modes.find(e => e.mode === (action.mode ?? null)).spec),
    canRefreshUnableHand: () => d.refresh, canDrawSpecial: () => d.draw, canRefine: () => d.refine,
    stoneCounts: team => d.stones[team], synthesisOptions: team => d.synthesis[team], getHealingLimit: id => players[id].healingLimit,
    canPayEnergy: (id, kind, count = 1) => (kind === 'gem' ? players[id].energy.gem : players[id].energy.gem + players[id].energy.crystal) >= count,
  };
}
export function isolatePolicy(raw, {history = true, activation = false} = {}) {
  const view = (game, id, actions = false) => observationView(captureObservation(game, id, {actions, history, activation}));
  const requestView = (request, v) => {
    const out = {};
    for (const key of ['type','playerId','skillId','purpose','recipientId','targetId','count','optional','defaultValue','shieldable','isCounter','damage','reservedEnergy','reservedHealing','energy','choices']) if (request[key] !== undefined) out[key] = copy(request[key]);
    for (const key of ['target','actor','player','nextTarget']) if (request[key]) out[key] = v.player(request[key].id);
    if (request.counterTargets) out.counterTargets = request.counterTargets.map(p => v.player(p.id));
    if (request.valid) out.valid = request.valid.map(e => typeof e === 'number' ? e : {index: e.index, card: v.cards.get(e.card.id)});
    if (request.context) out.context = { targetId: request.context.targetId, amount: request.context.amount, damageType: request.context.damageType, isCounter: request.context.isCounter, card: v.cards.get(request.context.card?.id) };
    if (request.attack) out.attack = v.cards.get(request.attack.id);
    return out;
  };
  return { ...raw,
    rankAiActions: (g, id) => raw.rankAiActions(view(g, id, true), id),
    chooseAiAction(g, id) { return this.rankAiActions(g,id)[0].action; },
    chooseAiResponse(g, r) { const v = view(g,r.target.id); return raw.chooseAiResponse(v,requestView(r,v)); },
    chooseAiRuleDecision(r,g) {
      if (!g) return r.defaultValue ?? null;
      const id = r.playerId ?? r.player?.id, v = view(g,id);
      if (r.type === 'overflow') return g.resolveOverflow(id,raw.chooseAiDiscard(v,id,v.player(id).hand.length-v.player(id).handLimit));
      return raw.chooseAiRuleDecision(requestView(r,v),v);
    },
    chooseAiDiscard: (g,id,count,valid) => raw.chooseAiDiscard(view(g,id),id,count,valid),
    cardScore(g,id,card,retained=[]) { const v=view(g,id); return raw.cardScore(v,id,v.cards.get(card.id),retained.map(c=>v.cards.get(c.id))); },
    keepCards(g,id,cards,count) { const v=view(g,id); const ids=new Set(raw.keepCards(v,id,cards.map(c=>v.cards.get(c.id)),count).map(c=>c.id)); return [...ids].map(id=>cards.find(c=>c.id===id)); },
    giftScore(g,id,recipient,card) { const v=view(g,id); return raw.giftScore(v,id,recipient,v.cards.get(card.id)); },
    planWindAttacks(g,id,options={}) { const v=view(g,id); return raw.planWindAttacks(v,id,{...options,card:v.cards.get(options.card?.id)}); },
  };
}
