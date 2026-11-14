import { createDeck } from '../../cards.js';
import { cheapCards, usefulExtra } from "../shared/ai/decisions.js";
import { planWindSequence, planWindState } from '../wind-swordmaster/ai-wind-plan.js';
const printed = createDeck(), spellRate = printed.filter(card=>card.type==='spell').length / printed.length;
const windSkills = ['galeArt','stormArt','windFury','swordShadow'];
const attacks = player => player.hand.filter(card=>card.type==='attack');
const transformedPlan = player => planWindSequence({...player,skillIds:windSkills},null,
  {energy:Math.min(player.energyLimit??3,player.energy.gem+player.energy.crystal+2)});
const oathChance = state => 1-(1-spellRate)**(state.teams.red.cups+state.teams.blue.cups+1);
function refinePlan(state,id,gem,crystal) {
  const player=state.players[id],team=state.teams[player.team];
  const fresh={...player,heroState:{...player.heroState,residualUsed:false}};
  const before=planWindSequence(fresh,null,{teamStones:team.gem+team.crystal});
  const after=planWindSequence(fresh,null,{energy:player.energy.gem+player.energy.crystal+gem+crystal,
    teamStones:team.gem+team.crystal-gem-crystal});
  return {before,after};
}
function extraUseful(args,api) {
  const {state,id,request,context}=args;
  const plan=planWindState(state,id,{offer:request.skillId,card:context.card});
  if(plan.count>=3&&(state.turn?.attackCount??0)<3)return plan.offers.includes(request.skillId);
  const next=api.copy(state);api.payEnergy(next,id,1,'crystal');
  return api.bestAttackScore(args.game,id,next).score > api.evaluate(state)-api.evaluate(next)+2;
}
export const swordChildAi = {
  id: "swordChild",
  energyPreference: 'crystal',
  cardBonus: ({ card, elements, retained }) => {
    if(card.type!=='attack')return 0;
    const reserve=retained.filter(c=>c.type==='attack').length<3?12:0;
    return reserve+(card.uniqueSkills.some(s=>['galeArt','stormArt'].includes(s))?25:elements.includes('wind')?18:8);
  },
  // A ready hand matters before the random transformation too. The real
  // transformed turn is handled by Wind Swordmaster's +1 damage evaluator.
  resourceValue(player) {
    const ready = player.hand.length ? attacks(player).length>=2 : player.count>=2;
    const energy = player.energy.gem+player.energy.crystal;
    return (ready ? Math.min(1,energy)*5+Math.min(1,Math.max(0,energy-1)) : 0) +
      (!player.heroState.admiresWitch && attacks(player).length>=3 && transformedPlan(player).count>=3 ? 6 : 0);
  },
  refineBonus({state,id,gem,crystal}) {
    const p=state.players[id], {before,after}=refinePlan(state,id,gem,crystal);
    if(before.count<3&&after.count>=3)return 15;
    // The transformation itself grants two crystals; do not hoard energy just
    // for that turn or refine away the only stone needed by Wind Sword.
    return !p.energy.gem&&!p.energy.crystal&&after.count>=2 ? 7 : 0;
  },
  attackHitBonus: ({state,player,active}) => active ? 5 + (!player.heroState.admiresWitch ? oathChance(state)*8 : 0) : 0,
  actionBonus({state,id,action}) {
    const card=action.type==='play'?state.players[id].hand[action.index]:null;
    if(card?.type!=='attack')return 0;
    const plan=planWindState(state,id,{firstCardId:card.id}), start=state.turn?.attackCount??0;
    return start<3&&plan.count>=3 ? (3-start)*3 + plan.preference*.08-plan.stoneCost*2 : plan.count===2 ? -2 : 0;
  },
  teamSynthesisBonus({state,player}) {
    if(player.heroState.admiresWitch||state.teams[player.team].cups>=4)return 0;
    // A cup opens an oath check at this turn's end. Its chance grows with the
    // total cups, but this is a small opportunity bonus, not a promised form.
    const total=state.teams.red.cups+state.teams.blue.cups;
    const chance=1-(1-spellRate)**(total+2);
    return chance*(transformedPlan(player).count>=3?3:1.5);
  },
  decisions: {
    windSword: (a,api) => {
      if(a.context.card?.uniqueSkills.includes('stormArt'))return true;
      const plan=planWindState(a.state,a.id,{offer:'windSword',card:a.context.card});
      if(plan.count>=3)return plan.offers.includes('windSword');
      return api.bestAttackScore(a.game,a.id,a.state).score>7;
    },
    windSwordStone: ({ request }) => request.choices.find(c=>c.value==='crystal')?.value ?? request.defaultValue,
    swordOath: () => true,
    oathCard: ({ request, player, game, id },api) => {
      if(player.count>=player.limit)return null;
      const ready=transformedPlan(player).count>=3;
      const value=choice=>{
        const card=game.cards.get(choice.value);
        const projected={...player,hand:[...player.hand,card]};
        return api.cardScore(game,id,card)+(card.type==='attack'&&attacks(player).length<3?12:0)+
          (!ready&&transformedPlan(projected).count>=3?18:0);
      };
      return [...request.choices].filter(c=>c.value!=null).sort((a,b)=>value(b)-value(a))[0]?.value??null;
    },
    swordAfterimage: (a,api) => a.request.type==='skillChoice'?extraUseful(a,api):undefined,
    afterimageTarget: ({request,state,game,id},api) => {
      const score=targetId=>{
        const next=api.copy(state);api.discardEstimate(next,targetId,1);
        const follow=Math.max(0,...attacks(next.players[id]).map(card=>api.attackScore(game,id,next,card,targetId,{follow:false})));
        return api.evaluate(next)-api.evaluate(state)+follow;
      };
      return [...request.choices].sort((a,b)=>score(b.value)-score(a.value))[0]?.value??request.defaultValue;
    },
    swordSeverance: usefulExtra,
    swordSeveranceCost: cheapCards,
  },
};
