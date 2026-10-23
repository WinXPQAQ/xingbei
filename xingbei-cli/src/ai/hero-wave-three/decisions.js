import { magicBranches } from "../v1.5-plans4/planner.js";
import { sameElements, distinctElements } from "../../card-sets.js";
import { cardScore, cardCost, chooseAiDiscard, elements } from "./cards.js";
import { publicState, copy, evaluate, terminal, energy, hurt, damageGain, echoGain, applyDamage, draw, payEnergy, spend, lowerHandLimit } from "./model.js";
import { attackScore, bestAttackScore, bestSpellFollow, bestRuneSet, preparationOptions, chooseHades, foes } from "./scoring.js";
const sumBranches = (branches) => branches.reduce((sum, b) => sum + b.probability * evaluate(b.state), 0);
const sameTeam = (game, id, targetId) => game.player(id).team === game.player(targetId).team;
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
function bestEcho(state,id,amount,excluded) {
  return state.players.filter((p)=>p.id!==excluded)
    .map((p)=>({targetId:p.id,score:echoGain(state,id,p.id,amount)}))
    .sort((a,b)=>b.score-a.score)[0]??{score:0,targetId:null};
}
function bestRebound(game,id,state,validSets) {
  return foes(state,id).map((t)=>bestRuneSet(game,id,state,"spellRebound",t.id,0,validSets))
    .sort((a,b)=>b.score-a.score)[0]??{indexes:null,score:0,targetId:null};
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
  if (request.type === "skillChoice") {
    switch(skill) {
      case "stealth": return activationUseful(game,id,state,request,"stealth");
      case "shadowGathering":
        if ((request.reservedSkillId??game.turn.state?.reservedSkillId)==="shadowMeteor") return true;
        return activationUseful(game,id,state,request,"shadowGathering");
      case "asuraCombo": return bestAttackScore(game,id,state,{element:"fire"}).score>0;
      case "hadesTremor": return !!ctx.card&&ctx.targetId!=null&&chooseHades(game,id,state,ctx.card,ctx.targetId);
      case "judgmentRitual": {
        if(p.energy.gem<=0||energy(p)<=(request.reservedEnergy??0)||p.count>5)return false;
        const next=copy(state);payEnergy(next,id,1,"gem");next.players[id].heroState.form="审判";lowerHandLimit(next,id,5);
        return !terminal(next)&&evaluate(next)-evaluate(state)+3>0;
      }
      case "ritualBreak": {
        const team=state.teams[p.team];
        return (p.count>=p.limit&&team.morale<=7)||(team.cups===4&&team.gem+team.crystal===2)||
          ((p.heroState.judgment??0)>=3&&team.gem+team.crystal<5);
      }
      case "prayer": return activationUseful(game,id,state,request,"prayer");
      case "manaTide": {
        const next=copy(state);payEnergy(next,id);
        return bestSpellFollow(game,id,next)+evaluate(next)-evaluate(state)>1;
      }
      case "powerBlessing": {
        if(ctx.targetId==null||sameTeam(game,id,ctx.targetId))return false;
        return damageGain(state,id,ctx.targetId,(ctx.amount??2)+2,"attack")-damageGain(state,id,ctx.targetId,ctx.amount??2,"attack")>1;
      }
      case "speedBlessing": return bestAttackScore(game,id,state).score>1;
      case "runeReconstruction": return activationUseful(game,id,state,request,"runeReconstruction");
      case "angerSuppression": {
        if ((p.heroState.magicRunes??0)>0&&ctx.targetId!=null&&bestRuneSet(game,id,state,"magicRuneFusion",ctx.targetId,0).score>0) return false;
        return (p.heroState.magicRunes??0)<2;
      }
      case "doubleEcho": {
        const next=copy(state);payEnergy(next,id);
        return bestEcho(next,id,Math.min(3,ctx.amount??0),ctx.targetId).score+evaluate(next)-evaluate(state)>1;
      }
    }
    return request.defaultValue??false;
  }
  if (request.type === "numberChoice") {
    if (skill === "waterShadow") {
      const reserved=new Set(game.turn.state?.reservedCardIds??[]);
      const useful=player.hand.filter((c)=>elements(game,id,c).includes("water")&&!reserved.has(c.id)&&cardScore(game,id,c)<130).length;
      const needed=Math.max(0,p.count+(ctx.drawCount??ctx.count??0)-p.limit);
      return Math.min(needed,useful,Math.max(...request.choices.map((c)=>Number(c.value))));
    }
    if (skill === "stealth") return p.count+1<=p.limit-1&&p.count<=2?1:0;
    if (skill === "shadowMeteor") {
      const room=game.getEnergyLimit(id)-energy(p), team=state.teams[p.team];
      if(room<=0||p.energy.gem>0||team.cups>=4||team.gem+team.crystal<4)return "keep";
      const options=request.choices.filter((c)=>c.value!=="keep");
      options.sort((a,b)=>Number(a.value.split(":")[0])-Number(b.value.split(":")[0]));
      return options[0]?.value??"keep";
    }
    if (skill === "runeReconstruction") {
      const pairs=player.hand.some((c,i)=>player.hand.slice(i+1).some((o)=>sameElements(game,id,[c,o])));
      const diverse=player.hand.some((c,i)=>player.hand.slice(i+1).some((o)=>distinctElements(game,id,[c,o])));
      return pairs?(diverse?2:3):0;
    }
    if (ctx.purpose === "extraRunes" && ctx.targetId!=null) {
      let best={value:0,score:0};
      const base=damageGain(state,id,ctx.targetId,ctx.amount??0,ctx.damageType??"spell");
      for(const item of request.choices) {
        const score=damageGain(state,id,ctx.targetId,(ctx.amount??0)+item.value,ctx.damageType??"spell")-base-item.value*.75;
        if(score>best.score)best={value:item.value,score};
      }
      return best.value;
    }
    return request.defaultValue;
  }
  if (request.type === "cardChoice") {
    if (request.validSets) {
      if (skill === "spellRebound") return bestRebound(game,id,state,request.validSets).indexes;
      if (["battleRuneStrike","magicRuneFusion"].includes(skill))
        return bestRuneSet(game,id,state,skill,ctx.targetId,ctx.amount??0,request.validSets).indexes;
      return [...request.validSets].sort((a,b)=>cardCost(game,id,a.map((i)=>player.hand[i]))-cardCost(game,id,b.map((i)=>player.hand[i])))[0]??null;
    }
    const valid=request.valid??player.hand.map((_,i)=>i);
    if (skill === "waterShadow") {
      const reserved=new Set(game.turn.state?.reservedCardIds??[]);
      const available=valid.filter((i)=>!reserved.has(player.hand[i].id));
      if(request.optional&&(p.count+(ctx.drawCount??0)<=p.limit||!available.some((i)=>cardScore(game,id,player.hand[i])<130)))return null;
      return lowCards(game,id,available.length>=request.count?available:valid).slice(0,request.count);
    }
    return chooseAiDiscard(game,id,request.count,valid);
  }
  if (request.type === "playerChoice") {
    if (skill === "doubleEcho") return request.choices.map((c)=>({value:c.value,score:echoGain(state,id,c.value,ctx.amount??0)})).sort((a,b)=>b.score-a.score)[0].value;
    if (skill === "spellRebound") return request.choices.map((c)=>({value:c.value,score:state.players[c.value].team===p.team?-1e6:damageGain(state,id,c.value,ctx.amount??1)})).sort((a,b)=>b.score-a.score)[0].value;
    return request.choices.map((c)=>({value:c.value,score:(state.players[c.value].team===p.team?1:-1)*Math.max(0,state.players[c.value].healingLimit-state.players[c.value].healing)})).sort((a,b)=>b.score-a.score)[0]?.value??request.defaultValue;
  }
  return request.defaultValue??null;
}
export function chooseAiResponse(game, request) {
  const id=request.target.id, state=publicState(game,id), take=copy(state);
  const amount=request.damage??request.context?.amount??2;
  if(request.shieldable!==false&&game.player(id).getStatus("holyShield").length)
    take.players[id].effects=take.players[id].effects.filter((e)=>e.name!=="holyShield");
  else {
    const actual=hurt(take,id,amount,request.attack?"attack":"spell");
    if(request.attack&&actual>0&&state.players[id].hero==="assassin"&&!terminal(take)&&request.actor)draw(take,request.actor.id,1);
  }
  let best={decision:null,score:evaluate(take)-evaluate(state)};
  for(const entry of request.valid) {
    const card=entry.card;
    if(request.attack&&card.type==="attack") {
      if(state.players[id].hero==="prayer"&&["powerBlessing","speedBlessing"].some((skill)=>card.hasUniqueSkill(skill))&&request.valid.some((other)=>other.card.type==="attack"&&
        !["powerBlessing","speedBlessing"].some((skill)=>other.card.hasUniqueSkill(skill))&&elements(game,id,other.card).some((e)=>elements(game,id,card).includes(e))))continue;
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
