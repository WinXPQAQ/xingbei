import { magicBranches } from "../base/planner.js";
import { cardScore, cardCost, chooseAiDiscard } from "./cards.js";
import { publicState, copy, evaluate, terminal, hurt, applyDamage, spend } from "./model.js";
import { attackScore, preparationOptions, scoringApi } from "./scoring.js";
import { heroAi, skillDecision } from "./registry.js";
const sumBranches = (branches) => branches.reduce((sum, b) => sum + b.probability * evaluate(b.state), 0);
const lowCards = (game, id, indexes) => [...indexes].sort((a,b) => cardScore(game,id,game.player(id).hand[a])-cardScore(game,id,game.player(id).hand[b]));
function reservedAttack(game, id, request) {
  const ids = request.reservedCardIds ?? game.turn.state?.reservedCardIds ?? [];
  const card = game.player(id).hand.find((c) => ids.includes(c.id) && c.type === "attack");
  const targets = game.turn.state?.reservedTargetIds ?? [];
  return card && targets.length ? { type: "play", index: game.player(id).hand.indexOf(card), targetId: targets[0] } : null;
}
function activationUseful(game, id, state, request, skillId) {
  const action = reservedAttack(game,id,request);
  if (!action) return false;
  const card = game.player(id).hand[action.index];
  const before = attackScore(game,id,state,card,action.targetId);
  const prepared = preparationOptions(game,id,{...state,turn:{...state.turn,activationDone:false}},action)
    .find((entry)=>entry.activated===skillId)?.state;
  if (!prepared || terminal(prepared)) return false;
  return evaluate(prepared)-evaluate(state)+attackScore(game,id,prepared,card,action.targetId)>before+0.5;
}
export function chooseAiRuleDecision(request, game) {
  const id=request.playerId??request.player?.id, player=game.player(id), state=publicState(game,id), p=state.players[id];
  const ctx=request.context??{}, skill=request.skillId;
  if (request.type === "healing") {
    let best={value:0,score:-Infinity};
    for (const item of request.choices) {
      const next=copy(state);applyDamage(next,id,ctx.amount??0,item.value,ctx.damageType??"spell",ctx.moraleLoss!==false);
      const score=evaluate(next);if(score>best.score)best={value:item.value,score};
    }
    return best.value;
  }
  const decision = skillDecision(skill)?.({ game, id, state, player: p, source: player, request, context: ctx }, decisionApi);
  if (decision !== undefined) return decision;
  if (request.type === "skillChoice") return request.defaultValue ?? false;
  if (request.type === "numberChoice") return request.defaultValue;
  if (request.type === "cardChoice") {
    if (request.validSets) return [...request.validSets].sort((a, b) =>
      cardCost(game, id, a.map((i) => player.hand[i])) - cardCost(game, id, b.map((i) => player.hand[i])))[0] ?? null;
    return chooseAiDiscard(game, id, request.count, request.valid ?? player.hand.map((_, i) => i));
  }
  if (request.type === "playerChoice") return request.choices.map((c) => ({ value: c.value,
    score: (state.players[c.value].team === p.team ? 1 : -1) * Math.max(0, state.players[c.value].healingLimit - state.players[c.value].healing),
  })).sort((a, b) => b.score - a.score)[0]?.value ?? request.defaultValue;
  return request.defaultValue??null;
}
export function chooseAiResponse(game, request) {
  const id=request.target.id, state=publicState(game,id), take=copy(state);
  const amount=request.damage??request.context?.amount??2;
  if(request.shieldable!==false&&game.player(id).getStatus("holyShield").length)
    take.players[id].effects=take.players[id].effects.filter((e)=>e.name!=="holyShield");
  else {
    const actual=hurt(take,id,amount,request.attack?"attack":"spell");
    if (request.attack && request.actor) heroAi(state.players[id].hero).afterAttackDamage?.({ state: take, actorId: request.actor.id, actual }, scoringApi);
  }
  let best={decision:null,score:evaluate(take)-evaluate(state)};
  for(const entry of request.valid) {
    const card=entry.card;
    if(request.attack&&card.type==="attack") {
      if (heroAi(state.players[id].hero).skipCounterCard?.({ game, id, card, request }, scoringApi)) continue;
      for(const target of request.counterTargets) {
        const score=attackScore(game,id,state,card,target.id,{active:false,follow:false});
        if(score>best.score)best={decision:{index:entry.index,targetId:target.id},score};
      }
    } else {
      const next=copy(state), selected=next.players[id].hand.find((c)=>c.id===card.id);
      spend(next,id,[selected]);
      const targetId=request.nextTarget?.id??null;
      const score=(card.name==="holyLight"?evaluate(next):sumBranches(magicBranches(next,id,targetId,amount+1)))-evaluate(state)-cardCost(game,id,[card]);
      if(score>best.score)best={decision:{index:entry.index,targetId},score};
    }
  }
  return best.decision;
}

const decisionApi = { ...scoringApi, lowCards, activationUseful };
