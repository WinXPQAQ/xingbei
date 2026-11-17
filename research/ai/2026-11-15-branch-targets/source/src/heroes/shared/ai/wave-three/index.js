import { isolatePolicy } from "../../../../ai/observation.js";
import { heroIds, acceptsAction, cardScore, keepCards, chooseAiDiscard } from "./cards.js";
import { rankAiActions } from "./scoring.js";
import { chooseAiResponse, chooseAiRuleDecision } from "./decisions.js";
import { sharedDecisionSkills } from "./registry.js";

export function createHeroWaveThreePolicy(base) {
  const fresh=isolatePolicy({rankAiActions,chooseAiResponse,chooseAiRuleDecision,cardScore,keepCards,chooseAiDiscard,
    giftScore:(game,id,target,card)=>cardScore(game,id,card),planWindAttacks:()=>null},{activation:true});
  const policy={...base,acceptsAction:(game,id,action)=>heroIds.has(game.player(id).hero.id)
    ?acceptsAction(game,id,action):(base.acceptsAction?.(game,id,action)??true)};
  for(const method of ["rankAiActions","chooseAiDiscard","cardScore","keepCards","giftScore","planWindAttacks"])
    policy[method]=(game,id,...args)=>(heroIds.has(game.player(id).hero.id)?fresh:base)[method](game,id,...args);
  policy.chooseAiAction=(game,id)=>policy.rankAiActions(game,id)[0].action;
  policy.chooseAiResponse=(game,request)=>(heroIds.has(request.target.hero.id)?fresh:base).chooseAiResponse(game,request);
  policy.chooseAiRuleDecision=(request,game)=>{
    const id=request.playerId??request.player?.id;
    const sharedBlessing=sharedDecisionSkills.has(request.skillId);
    const freeOverflow=request.type==="healing"&&request.context?.moraleLoss===false;
    return (game&&(heroIds.has(game.player(id).hero.id)||sharedBlessing||freeOverflow)?fresh:base).chooseAiRuleDecision(request,game);
  };
  delete policy.traceDecision;delete policy.replayTrace;
  return policy;
}
