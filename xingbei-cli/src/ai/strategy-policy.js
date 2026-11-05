import { captureObservation, observationView } from './observation.js';
import { publicState } from '../heroes/shared/ai/wave-three/model.js';
import { heroAi } from '../heroes/shared/ai/wave-three/registry.js';
import { heroPolicies as secondWave } from '../heroes/shared/ai/wave-two/registry.js';
import { aiFor } from '../heroes/shared/ai/base/registry.js';

const profileFor = id => ({...aiFor(id), ...secondWave()[id], ...heroAi(id)});
function energyPreference(game, state, player, profile) {
  if (profile.energyPreference) return profile.energyPreference;
  const action={type:'refine',stones:{gem:1,crystal:1}};
  // Reuse existing explicit AI preferences. Missing declarations are unknown,
  // not proof that a hero cannot spend either kind of energy.
  if (profile.acceptsRefine?.(action,{game,id:player.id,player:game.player(player.id)}) === false ||
      profile.acceptsCrystalRefinement?.(game.player(player.id),action) === false) return 'gem';
  const uses=profile.energyUses?.(state,player,{known:player.hand,attacks:player.id===state.observer
    ?player.hand.filter(c=>c.type==='attack').length:player.count*.6,enemies:state.players.filter(p=>p.team!==player.team)})??[];
  return uses.length ? uses.every(use=>use.kind==='gem')?'gem':uses.every(use=>use.kind==='either')?'crystal':'mixed' : null;
}

// Preferences adjust only the rule teacher. They neither remove engine legal
// commands nor become rewards for the learned policy.
export function withStrategyPreferences(policy) {
  const adapted={...policy,
    rankAiActions(game,id) {
      const ranked=policy.rankAiActions(game,id);
      if (!ranked.some(e=>['refine','synthesize'].includes(e.action.type))) return ranked;
      const view=observationView(captureObservation(game,id,{actions:true,activation:true}));
      const state=publicState(view,id), player=state.players[id], profile=profileFor(player.hero);
      const preference=energyPreference(view,state,player,profile);
      const gemNeed=state.players.filter(p=>p.team===player.team&&p.id!==id&&p.energy.gem===0)
        .filter(p=>energyPreference(view,state,p,profileFor(p.hero))==='gem').length;
      return ranked.map(entry=>{
        const action=entry.action;
        let adjustment=0;
        if(action.type==='refine') {
          const {gem,crystal}=action.stones;
          if(gem+crystal===1 && !profile.acceptsSingleRefine?.({game:view,state,id,player:view.player(id),action})) adjustment-=12;
          if(preference==='gem') {
            const allowance=typeof profile.usefulCrystals==='function'
              ?profile.usefulCrystals({game:view,state,id,player,action}):profile.usefulCrystals??0;
            const useful=Math.max(0,allowance-player.energy.crystal);
            adjustment-=Math.max(0,crystal-useful)*18;
          } else if(preference==='crystal') {
            // Flexible consumers leave red stones for allies whose skills need
            // them. A shortage of blue never makes a legal red refine illegal.
            adjustment-=gem*(2+Math.min(2,gemNeed)*3);
          }
        } else if(action.type==='synthesize') {
          for(const ally of state.players.filter(p=>p.team===player.team))
            adjustment+=profileFor(ally.hero).teamSynthesisBonus?.({state,player:ally,actorId:id})??0;
        }
        return adjustment ? {...entry,score:entry.score+adjustment,explanation:{...entry.explanation,strategyPreference:adjustment}}:entry;
      }).sort((a,b)=>b.score-a.score);
    },
    chooseAiAction(game,id) { return adapted.rankAiActions(game,id)[0]?.action; },
  };
  return adapted;
}
