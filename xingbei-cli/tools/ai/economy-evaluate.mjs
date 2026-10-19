// Evaluation-only telemetry; never passed into policy observations.
import {Game,Timing} from '../../src/engine.js';
import {getPolicy} from '../../src/ai/versions.js';
import {policyView,publicRequest} from './privacy.mjs';
import {captureObservation,observationView} from '../../src/ai/observation.js';
import {stateOf,energyPlan,burden,components} from '../../src/ai/v1.3/model.js';
const emptyMetrics=()=>({attacks:0,hits:0,damage:0,attackDamage:0,spellDamage:0,moraleLost:0,gems:0,crystals:0,cups:0,actions:0,turns:0,highHandTurns:0,idleEnergyTurns:0,activeKeyCardsSpent:0,gifts:0,giftRecipientBurdenDelta:0,giftHandValueDelta:0,giftNextTurnHighHand:0,passes:0});
export async function playEconomyMatch(config, { candidate = 'read-1', opponent = 'v1.0', turnLimit = 500, audit = false, observations = true } = {}) {
  const { lineup, seed, start, team } = config;
  const heroIds = config.heroIds;
  const game = new Game({ seed, heroIds }).setup();
  game.current = start;
  if (!observations) game.publicHistory = { events: [], sequence: 0, move() {}, attack() {}, append() {} };
  const policies = { red: getPolicy(team === 'red' ? candidate : opponent), blue: getPolicy(team === 'blue' ? candidate : opponent) };
  const metrics = { red: emptyMetrics(), blue: emptyMetrics() };
  const initial = game.players.map(p => ({ id:p.id, hero:p.hero.id, team:p.team, handCount:p.hand.length }));
  const give = game.giveCards, pendingGifts=[];
  game.giveCards = function(id,targetId,cards) {
    const m=metrics[this.player(id).team],before=components(stateOf(observationView(captureObservation(this,id)),id));
    m.gifts++;m.giftRecipientBurdenDelta+=burden(this.player(targetId).hand.length+cards.length,this.player(targetId).handLimit)-burden(this.player(targetId).hand.length,this.player(targetId).handLimit);
    const result=give.call(this,id,targetId,cards),after=components(stateOf(observationView(captureObservation(this,id)),id));
    m.giftHandValueDelta+=after.ownHand+after.otherHands-before.ownHand-before.otherHands;pendingGifts.push({team:this.player(id).team,targetId});return result;
  };
  const policy = id => policies[game.player(id).team];
  const view = id => audit ? policyView(game, id) : game;
  const discard = (id, excess) => policy(id).chooseAiDiscard(view(id), id, excess);
  const response = request => { const v = view(request.target.id); return policy(request.target.id).chooseAiResponse(v, audit ? publicRequest(request,v) : request); };
  const options = {
    overflow: (player, excess) => discard(player.id, excess),
    choose: request => decide(request),
    chooseResponse: response,
    resolveOverflow: request => game.resolveOverflowWithDecisions(request.player.id,
      discard(request.player.id, request.player.hand.length - request.player.handLimit), options),
  };
  function decide(request) {
    if (request.type === 'response') return options.chooseResponse(request);
    if (request.type === 'overflow') return options.resolveOverflow(request);
    const id = request.playerId ?? request.player?.id;
    if (id == null) throw new Error(`Unrouted decision: ${request.type}`);
    const v = view(id);
    return policy(id).chooseAiRuleDecision(audit ? publicRequest(request, v) : request, v);
  }
  // All synchronous nested choices (e.g. draw overflow / angel shelter) are routed
  // too. Never fall back to the production AI imported by Game.
  game.automaticDecision = request => decide(request);
  const trigger = game.trigger;
  game.trigger = function* (timing, context, options) {
    yield* trigger.call(this, timing, context, options);
    if (timing === Timing.ATTACK_DECLARED) metrics[this.player(context.actorId).team].attacks++;
    if (timing === Timing.ATTACK_HIT) metrics[this.player(context.actorId).team].hits++;
    if (timing === Timing.DAMAGE_ACTUAL && context.sourceId != null) {
      const m = metrics[this.player(context.sourceId).team];
      // Friendly/self damage is negative utility, not offensive credit.
      const sign = this.player(context.sourceId).team === this.player(context.targetId).team ? -1 : 1;
      m.damage += sign * context.actual;
      m[context.damageType === 'spell' ? 'spellDamage' : 'attackDamage'] += sign * context.actual;
    }
  };
  const changeMorale = game.changeMorale;
  game.changeMorale = function (side, amount) { const before = this.teams[side].morale; const result = changeMorale.call(this, side, amount); metrics[side].moraleLost += Math.max(0, before - this.teams[side].morale); return result; };
  const addStones = game.addStones;
  game.addStones = function (side, kind, count) { const result = addStones.call(this, side, kind, count); metrics[side][kind === 'gem' ? 'gems' : 'crystals'] += result; return result; };
  let turns = 0;
  const started = performance.now();
  while (!game.winner && turns < turnLimit) {
    turns++;
    const id = game.current;
    const player=game.player(id),m=metrics[player.team];m.turns++;m.highHandTurns+=Number(player.hand.length>=player.handLimit-1);
    for(let i=pendingGifts.length-1;i>=0;i--)if(pendingGifts[i].targetId===id){metrics[pendingGifts[i].team].giftNextTurnHighHand+=Number(player.hand.length>=player.handLimit-1);pendingGifts.splice(i,1);}
    const obs=observationView(captureObservation(game,id));const modeled=stateOf(obs,id);m.idleEnergyTurns+=Number(player.energy.gem+player.energy.crystal>0&&energyPlan(modeled,modeled.players[id])<=1.5);
    const turn = await game.beginTurn(id, { choose: options.choose, chooseWeakness: options.choose, resolveOverflow: options.resolveOverflow }, options);
    if (!turn.skipped && !game.winner) {
      let actions = 0;
      do {
        if (++actions > 20) throw new Error(`Action limit: ${JSON.stringify(config)}`);
        const action = policy(id).chooseAiAction(view(id), id);
        metrics[game.player(id).team].actions++;
        if(action.type==='pass')metrics[game.player(id).team].passes++;
        const handBefore=[...game.player(id).hand];
        if (action.type === 'pass') { if (game.turn.hasExtraActions()) game.skipExtraActions(id); break; }
        await game.executeAction(id, action, options);
        metrics[game.player(id).team].activeKeyCardsSpent+=handBefore.filter(c=>['darkStrike','holyLight'].includes(c.name)&&!game.player(id).hand.includes(c)).length;
        game.assertCardLocations();
      } while (game.turn.hasExtraActions() && !game.winner);
    }
    await game.endTurnWithDecisions(options);
    game.assertCardLocations();
  }
  for (const side of ['red','blue']) metrics[side].cups = game.teams[side].cups;
  const other = team === 'red' ? 'blue' : 'red';
  return { ...config, heroIds, winner: game.winner, outcome: !game.winner ? 'truncated' : game.winner === team ? 'win' : 'loss', turns,
    elapsedMs: performance.now() - started, metrics: { candidate: metrics[team], opponent: metrics[other] }, initial };
}

