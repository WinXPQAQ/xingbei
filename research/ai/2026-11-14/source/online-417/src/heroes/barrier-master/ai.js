import { damageTarget, discardTarget } from "../shared/ai/decisions.js";

const elements = (card, id) => card.traits?.[id]?.elements ?? card.elements ?? [];
const matching = (cards, id, attackElements) => cards.some(c => elements(c,id).some(e => attackElements.includes(e)));
const barriers = (game, id) => [...game.cards.values()].filter(c =>
  c.location.zone === "covered" && c.location.pile === "barrier" && c.location.playerId === id);

// Called by all attack planners. Public barriers can amplify either team, while
// declaration only grants ritual for active attacks. This modest preparation
// value must not outweigh the opportunity cost of spending an owner's unique.
export function previewBarrierAttack(state, id, card, targetId, { active = true } = {}) {
  let damageBonus = 0, supportValue = 0;
  const ritualOwners = [];
  const attackElements = elements(card,id), own = state.players[state.observer].team;
  for (const owner of state.publicBarriers ?? []) {
    if (!matching(owner.cards,owner.id,attackElements)) continue;
    damageBonus++;
    if (active && owner.ritual < 3) {
      supportValue += (owner.team === own ? 1 : -1) * .65;
      ritualOwners.push(owner.id);
    }
  }
  return { damageBonus, supportValue, ritualOwners };
}
function affinity(a, targetId, card, api) {
  const recipient = a.state.players[targetId];
  const unique = card.uniqueSkills.some(skill => recipient.skillIds.includes(skill));
  // Do not call another seat's hand-retention scorer: its hand is intentionally
  // opaque. Only the visible card and declared recipient skills are available.
  const fireUse = elements(card,targetId).includes("fire") && recipient.skillIds.some(skill =>
    ["azureCodex", "skyfireRift", "forbiddenPower"].includes(skill));
  const defensive = ["darkStrike", "holyLight"].includes(card.name);
  return (unique ? 5 : defensive ? 4 : card.type === "attack" ? 1.8 : 1.4) + (fireUse ? 2 : 0);
}
function receiving(a, card, targetId, api) {
  const next = api.copy(a.state), owner = next.players[card.location.playerId], recipient = next.players[targetId];
  owner.coveredCount = Math.max(0,owner.coveredCount-1);
  if (!owner.coveredCount) {
    owner.heroState.form = "glassRealm";
    for (const p of next.players) p.effects = p.effects.filter(e => e.id !== owner.heroState.realmCardId);
  }
  api.draw(next,targetId,1);
  const sign = recipient.team === a.player.team ? 1 : -1;
  const usable = Math.max(0,Math.min(1,recipient.limit-a.state.players[targetId].count));
  return api.evaluate(next)-api.evaluate(a.state)+sign*usable*affinity(a,targetId,card,api);
}
function currentAttackLoss(a, remaining, api) {
  const { context, state, id } = a;
  if (context.actorId == null || context.targetId == null || !context.card) return 0;
  const es = context.attackTraits?.elements ?? elements(context.card,context.actorId);
  const before = matching(barriers(a.game,id),id,es), after = matching(remaining,id,es);
  if (before === after) return 0;
  const amount = context.amount ?? 2;
  // The attack has not hit yet; the public response estimate discounts this
  // difference. It still retains the correct friendly/enemy direction.
  const chance = .75 ** state.players[context.targetId].count;
  return chance*(api.damageGain(state,id,context.targetId,amount+Number(after),"attack",{sourceId:context.actorId}) -
    api.damageGain(state,id,context.targetId,amount+Number(before),"attack",{sourceId:context.actorId}));
}
function removal(a, api) {
  const cards = barriers(a.game,a.id);
  return cards.map(card => {
    const remaining = cards.filter(c => c.id !== card.id);
    const future = remaining.length ? Math.max(...a.state.players.filter(p => p.team === a.player.team)
      .flatMap(p => remaining.map(c => affinity(a,p.id,c,api)))) * .15 : 0;
    return { card, score: currentAttackLoss(a,remaining,api)+future };
  }).sort((x,y) => y.score-x.score)[0];
}
function releaseValue(a, api) {
  const selected = removal(a,api);
  if (!selected) return -Infinity;
  const next=api.copy(a.state),p=next.players[a.id];
  p.heroState.ritual-=3;p.coveredCount--;p.heroState.form="glassRealm";
  const indexes=api.chooseAiDiscard(a.game,a.id,Math.min(1,p.count));
  api.remove(next,a.id,indexes.map(i=>p.hand[i]));
  return api.evaluate(next)-api.evaluate(a.state)+selected.score;
}
function realmOwner(a) {
  const realm=a.player.effects.find(e=>e.name==="absoluteRealm");
  return realm ? a.state.players.find(p=>p.heroState.realmCardId===realm.id) : null;
}
export const barrierMasterAi = {
  id: "barrierMaster",
  energyPreference: "crystal",
  sharedDecisionSkills: ["whiteKarma", "karmaCard"],
  cardBonus: ({ card, same }) => card.type === "attack" && !same ? 5 : 0,
  resourceValue: p => (p.heroState.ritual ?? 0)*1.5 + (p.coveredCount ?? 0)*2 + (p.heroState.form ? 6 : 0),
  refineBonus: ({ player, crystal }) => crystal && !player.energy.crystal && !player.energy.gem ? 5 : 0,
  scoreSkill({ game, state, next, id, player, skillId, targetId, costs }, api) {
    if (skillId === "barrierRitual") {
      player.coveredCount=2;player.heroState.ritual=Math.min(3,player.heroState.ritual+1);
      // Two distinct elements provide broader cooperation; visible skill cards
      // also retain a route to allies through Absolute Realm.
      const coverage=new Set(costs.flatMap(c=>elements(c,id))).size;
      return Math.min(2,coverage)*.75;
    }
    if (skillId !== "forbiddenRealm") return null;
    player.heroState.ritual--;api.discardEstimate(next,id,1);
    const target=next.players[targetId], cards=barriers(game,id);
    // Moving the unique realm also removes its protection from the old holder.
    for(const p of next.players)p.effects=p.effects.filter(e=>e.id!==player.heroState.realmCardId);
    target.effects.push({id:player.heroState.realmCardId,name:"absoluteRealm"});
    if (!cards.length) { target.effects=target.effects.filter(e=>e.id!==player.heroState.realmCardId);player.heroState.form="glassRealm";return 0; }
    const friendly=target.team===player.team;
    const chance=targetId===id?Number(player.hand.some(c=>c.type==="attack")):Math.min(.8,target.count*.15);
    const gift=Math.max(0,...cards.map(c=>receiving({game,state:next,id,player},c,targetId,api)));
    // Gift follows that holder's attack, so this is a discounted option rather
    // than an immediate transfer or a claim about an unseen attack card.
    return friendly?chance*gift*.65:0;
  },
  decisions: {
    wildGodRite: () => true,
    riteRelease: (a,api) => releaseValue(a,api)>0,
    removeBarrier: (a,api) => removal(a,api)?.card.id ?? a.request.defaultValue,
    glassRealm: () => true,
    glassTarget: discardTarget,
    glassKeep: () => true,
    whiteKarma(a,api) {
      const owner=realmOwner(a);if(!owner)return false;
      const ritual=(owner.team===a.player.team?1:-1)*Math.min(1,3-(owner.heroState.ritual??0))*1.5;
      const cards=barriers(a.game,owner.id), gift=cards.length?Math.max(...cards.map(c=>receiving(a,c,a.id,api))):0;
      return gift+ritual>0;
    },
    karmaCard: (a,api) => [...a.request.choices].filter(c=>a.game.cards.has(c.value))
      .sort((x,y)=>receiving(a,a.game.cards.get(y.value),a.id,api)-receiving(a,a.game.cards.get(x.value),a.id,api))[0]?.value ?? a.request.defaultValue,
    banishingRealm({state,id,player},api) {
      const next=api.copy(state);api.payEnergy(next,id,1,"crystal");
      return next.players.some(p=>p.team!==player.team&&api.damageGain(next,id,p.id,1)+api.evaluate(next)-api.evaluate(state)>0);
    },
    banishingTarget: damageTarget,
  },
};
