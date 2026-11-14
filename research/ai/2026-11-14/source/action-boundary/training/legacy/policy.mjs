// Partial, independently labelled port of original 1.6.7 scoring.
// Formula sources: card/xingBei.js; noname/get/index.js damageEffect;
// noname/library/index.js _gouMai/_heCheng/_tiLian. Original GPL-3.0.
// This is NOT the complete original AI. Dynamic hero callbacks, startup and
// complex responses retain the explicitly counted current-policy adapter.
import metadata from './static-orders.json' with { type: 'json' };
import { playableCards } from '../../src/playable-cards.js';
import { legalOverflowDiscard } from '../../src/inability.js';
export const LEGACY_POLICY = 'legacy-score-partial-v1';
let counts = {};
const record = key => { counts[key] = (counts[key] ?? 0) + 1; };
export function takeLegacyCoverage() { const result = counts; counts = {}; return result; }
const remaining = p => p.handLimit-p.hand.length;
// Old damageEffect's generic hand-space term. Hero-specific damage modifiers
// are not claimed covered; it is an opponent preference, never a rule/reward.
const damage = (p, n=2) => remaining(p)<n ? n-remaining(p)+1 : remaining(p)-3<n ? 1 : .5;
const values = {darkStrike:[7,7,3],holyLight:[7,4,1.1],holyShield:[3,2,0],weakness:[5,3,1],poison:[3,1],magicBullet:[4,2,0]};
export function legacyCardValue(card, hand) {
  const table=values[card.name] ?? [4,3,1];
  const duplicates=hand.slice(0,hand.indexOf(card)).filter(c=>c.name===card.name).length;
  return table[Math.min(duplicates,table.length-1)];
}
function playScore(game, id, action) {
  const p=game.player(id), c=playableCards(p)[action.index], t=game.player(action.targetId);
  if(!c||!t)return null;
  const enemy=t.team!==p.team, sign=enemy?-1:1;
  if(c.type==='attack')return [3.05, enemy?damage(t): -damage(t)];
  if(c.name==='holyShield')return [game.players.some(x=>x.team===p.team&&remaining(x)<=2)?3.4:3,sign*(10-remaining(t))];
  if(c.name==='weakness')return [game.players.some(x=>x.team!==p.team&&remaining(x)<=3)?3.4:3,-sign*t.hand.length];
  if(c.name==='poison')return [3,-sign*(remaining(t)<=4?2:1)];
  if(c.name==='magicBullet')return [3,-sign];
  return null;
}
function actionScore(game,id,raw) {
  const action=raw.type==='activate'?raw.plan?.action:raw;
  if(!action)return null;
  if(action.type==='play')return playScore(game,id,action);
  const p=game.player(id), stones=game.stoneCounts(p.team), enemy=p.team==='red'?'blue':'red';
  if(action.type==='skill') {
    const order=metadata.heroes[p.hero.id]?.[action.skillId]?.order;
    return order===undefined?null:[order,0];
  }
  if(action.type==='purchase')return [3+.15*(5-stones.total),stones.total<=3?Math.min(1,.1+.2*remaining(p)):0];
  if(action.type==='synthesize'){
    const morale=game.teams[enemy].morale;
    return [3.25+(morale<=5?.4*(5-morale):0)+(morale<=1?10:0)
      +(game.ruleVariant!=='morale-only-v1'&&game.teams[p.team].cups>=4?10:0)+.1*(stones.total-3),1];
  }
  // Old refinement's 50% stochastic admission is approximated by its mean.
  // Hero energy tags/cost choices remain current; no hidden cards are consulted.
  if(action.type==='refine')return [3.15+.05*(game.getEnergyLimit(id)-p.energy.gem-p.energy.crystal)+.06*stones.total,.5];
  return null;
}
export function createLegacyPolicy(base) {
  return {...base,
    chooseAiAction(game,id) {
      const ranked=base.rankAiActions(game,id);
      const fallback=ranked[0]?.action;
      if(!fallback)throw new Error('Legacy adapter has no legal action');
      // Unknown leading hero route stays with the current teacher rather than
      // being assigned a fictitious low score and silently dropping the skill.
      if(!actionScore(game,id,fallback)){record('currentFallback/action');return fallback;}
      const scored=ranked.map((entry,index)=>({action:entry.action,score:actionScore(game,id,entry.action),index}))
        .filter(e=>e.score&&(e.score[1]>0||(e.action.plan?.action??e.action).type==='skill'));
      if(!scored.length){record('currentFallback/action');return fallback;}
      scored.sort((a,b)=>b.score[0]-a.score[0]||b.score[1]-a.score[1]||a.index-b.index);
      const action=scored[0].action, underlying=action.plan?.action??action;
      record(underlying.type==='skill'?'staticHeroOrder/currentTargetRanking':'originalBaseOrder');
      return action;
    },
    chooseAiDiscard(game,id,count,valid=null) {
      record('originalBaseRetention');
      const hand=game.player(id).hand;
      const indices=valid??hand.map((_,i)=>i);
      const chosen=[...indices].sort((a,b)=>legacyCardValue(hand[a],hand)-legacyCardValue(hand[b],hand)||a-b).slice(0,count);
      return valid===null&&count===hand.length-game.player(id).handLimit?legalOverflowDiscard(game,id,chosen):chosen;
    },
    chooseAiResponse(game,request){record('currentFallback/response');return base.chooseAiResponse(game,request);},
    chooseAiRuleDecision(request,game){
      if(request.type==='weakness') {record('originalBaseWeakness');return remaining(game.player(request.playerId??request.player.id))>=3?'draw':'skip';}
      record(`currentFallback/${request.type}`);return base.chooseAiRuleDecision(request,game);
    },
  };
}
