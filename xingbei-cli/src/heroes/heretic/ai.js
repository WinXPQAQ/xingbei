import {
  cheapCards,
  cheapCovered,
  damageTarget,
} from "../shared/ai/decisions.js";
// The prophecy pile is concealed after shuffling. This plan uses only the
// current hand before placement; it never remembers or inspects the pile order.
function prophecyPlan({source,request,game,id},api) {
  const hand=source.hand, eligible=request.valid??hand.map((_,i)=>i).filter(i=>hand[i].category==='basic');
  const traits=c=>api.elements(game,id,c);
  const ordinary=hand.filter(c=>c.name!=='darkStrike'&&c.name!=='holyLight');
  const group=['water','earth','fire','thunder'].map(element=>({element,
    count:ordinary.filter(c=>traits(c).includes(element)).length})).sort((a,b)=>b.count-a.count)[0].element;
  // Reserve a usable ordinary action in addition to defensive dark/light and
  // the dominant calamity suit. Prefer a spell when one is available.
  const action=ordinary.filter(c=>c.type==='spell').sort((a,b)=>
    Number(traits(a).includes(group))-Number(traits(b).includes(group)))[0]??ordinary.find(c=>c.type==='attack');
  const lights=hand.filter(c=>c.name==='holyLight');
  const keepValue=card=>card.name==='darkStrike'?1000:card===lights[0]?900:card===action?850:
    card===lights[1]?180:card.name==='holyLight'?55/(lights.indexOf(card)-1):
    (traits(card).includes(group)?160:0)+(card.type==='spell'?12:0)+api.cardScore(game,id,card)/10;
  const count=request.count??6;
  const indexes=[...eligible].sort((a,b)=>keepValue(hand[a])-keepValue(hand[b])).slice(0,count);
  return {indexes,face:['water','earth'].includes(group)?'earthWater':'thunderFire'};
}
export const hereticAi = {
  id: "heretic",
  energyPreference: "crystal",
  sharedDecisionSkills: ["calamityDefense"],
  cardBonus: ({ card, player, elements }) => {
    const active=player.hero.state.prophecyFace;
    const group=active==='earthWater'?['earth','water']:active==='thunderFire'?['thunder','fire']:[];
    return (card.type==='spell'?7:0)+(elements.some(e=>group.includes(e))?10:0);
  },
  actionBonus: ({ game,id,action,player }) => action.type==='play'&&
    game.player(id).hand[action.index]?.name==='darkStrike'&&player.heroState.prophecyFace ? -10 : 0,
  resourceValue: (p) => (p.heroState.prophecyFace ? 4 : 0),
  refineBonus: ({ player, crystal }) =>
    crystal && !player.energy.gem && !player.energy.crystal
      ? (player.coveredCount ?? 0) <= 1 ? 10 : 6
      : 0,
  scoreSkill({ player, skillId }) {
    if (skillId !== "banishment") return null;
    return player.count <= 3 ? 10 : 3;
  },
  decisions: {
    banishmentDraw: ({ player }) => (player.count < 4 ? 7 : 6),
    prophecyFace: (a,api) => prophecyPlan(a,api).face,
    prophecyCards: (a,api) => prophecyPlan(a,api).indexes,
    banishmentAction: ({ source }) => source.hand.some(c=>c.type==='spell'&&c.name!=='holyLight')
      ? 'spell' : 'attack',
    heresyJudgment: () => true,
    judgmentTarget: damageTarget,
    judgmentCard: cheapCovered,
    sacrifice: () => true,
    sacrificeElement: () => "water",
    greed: ({ player }) => player.count >= 3,
    calamityOrder: ({ request, source }) =>
      [...request.choices].sort(
        (a, b) =>
          source.hand.filter((c) => c.elements.includes(b.value)).length -
          source.hand.filter((c) => c.elements.includes(a.value)).length,
      )[0].value,
    calamityCost: (a, api) =>
      cheapCards(
        {
          ...a,
          request: {
            ...a.request,
            validSets: [...a.request.validSets]
              .sort((x, y) => y.length - x.length)
              .filter(
                (x) =>
                  x.length ===
                  Math.max(...a.request.validSets.map((s) => s.length)),
              ),
          },
        },
        api,
      ),
    calamityDefense: ({ request }) =>
      [...request.validSets].sort((a, b) => b.length - a.length)[0],
    calamityTarget: (a, api) => damageTarget(a, api, a.context.amount ?? 2),
  },
};
