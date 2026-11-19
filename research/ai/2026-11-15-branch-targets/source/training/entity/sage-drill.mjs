// A controlled exercise, not a variant of the live game or a team-win label.
import fs from 'node:fs';
import path from 'node:path';
import { Game, Timing } from '../../src/engine.js';
import { distinctElements } from '../../src/card-sets.js';
import { decisionPlayer } from '../candidates.mjs';
import { resolveDecision } from '../decision-runner.mjs';

export const SAGE_DRILL = 'sage-self-codex-v1';
export const SAGE_POISON_DRILL = 'sage-poison-turn-v1';
export const DAMAGE_PLAN_CONTRACT = 'entities-v7+public-damage-plan-v1';
const basic = ['water', 'fire', 'wind', 'thunder', 'earth'];
export function sageHandSignature(game, id = 0) {
  const counts = Object.fromEntries(['light', 'dark', ...basic].map(e => [e, 0]));
  for (const card of game.player(id).hand) {
    const elements = card.getTraits({ game, playerId: id }).elements;
    if (elements.length !== 1 || !(elements[0] in counts)) throw new Error('Exercise requires single-element basic cards');
    counts[elements[0]]++;
  }
  return [counts.light, counts.dark, ...basic.map(e => counts[e]).sort((a,b) => b-a)];
}

export function makeSageDrill(seed, exercise = SAGE_DRILL, initialGems = 2) {
  const poisonTurn = exercise === SAGE_POISON_DRILL;
  const game = new Game({ seed, heroRules: false,
    heroIds: ['sage', 'berserker', 'marksman', 'sealer', 'guardianAngel', 'priest'] });
  game.replaceHero(0, 'sage');
  game.draw(0, poisonTurn ? 5 : 6); game.draw(1, game.player(1).handLimit);
  game.player(0).healing = 2; game.player(0).energy.gem = poisonTurn ? initialGems : 1;
  if (poisonTurn) {
    const card=game.deck.find(card=>card.name==='poison');
    game.attachCard(card.id,0,{effectId:'poison',sourcePlayerId:1});
  }
  game.log.length = 0;
  return game;
}

export async function driveSageDrill(config, select) {
  const { seed, decisionLimit = 256, capture = false, exercise = SAGE_DRILL } = config;
  const poisonTurn = exercise === SAGE_POISON_DRILL;
  const initialGems = poisonTurn ? (config.initialGems ?? 2) : 1;
  const gemRetentionBonus = poisonTurn ? (config.gemRetentionBonus ?? 0) : 0;
  const rewardScale = config.rewardScale ?? 15;
  if (![1,2].includes(initialGems) || ![0,4].includes(gemRetentionBonus) ||
      (gemRetentionBonus && initialGems!==1) || ![15,19].includes(rewardScale) || rewardScale<15+gemRetentionBonus)
    throw new Error('Invalid sustain exercise configuration');
  const started = performance.now(), game = makeSageDrill(seed, exercise, initialGems);
  const lossBudget = poisonTurn ? (config.lossBudget ?? 0) : 0;
  if (!Number.isInteger(lossBudget) || lossBudget<0 || lossBudget>3) throw new Error('Invalid training loss budget');
  if (poisonTurn) game.aiExercise = {objective:'enemyMoraleLoss',maxOwnMoraleLoss:lossBudget,startingOwnMorale:15,initialGems,gemRetentionBonus,rewardScale};
  const signature = sageHandSignature(game);
  const distinct = signature.filter(n => n > 0).length;
  const directDamage = Math.max(0, distinct - 1);
  const initialCards = game.player(0).hand.map(c => c.id);
  const trace = [];
  let engineRequests = 0, decisions = 0, enemySpellDamage = 0, reboundCount = 0, ownMoraleLoss = 0;
  let minimumOwnMorale = 15;
  const rootActions = [];
  let gemSpent=0, gemGained=0, wisdomTriggers=0;
  const originalRecord = game.recordPublicAction;
  game.recordPublicAction = function(event) {
    originalRecord.call(this, event);
    minimumOwnMorale = Math.min(minimumOwnMorale, this.teams.red.morale);
    if (event.type === 'damage' && event.sourceId === 0 && event.targetId === 1 && event.result === 'spell') enemySpellDamage += event.amount;
    if (event.type === 'skillNote' && event.skillId === 'spellRebound') reboundCount++;
    if (event.type === 'skillNote' && event.skillId === 'wisdomCodex') wisdomTriggers++;
    if (event.type === 'energy' && event.playerId === 0) {
      gemSpent+=Math.max(0,-(event.gem??0));gemGained+=Math.max(0,event.gem??0);
    }
  };
  const limit = Symbol('decisionLimit');
  async function pick(input) {
    if (++decisions > decisionLimit) throw limit;
    const index = await select(input);
    if (!Number.isInteger(index) || index < 0 || index >= input.candidates.length) throw new Error('Invalid drill selection');
    trace.push({ type: input.request.type, stage: input.request.stage, skillId: input.request.skillId,
      candidates: input.candidates, index, pendingDamage: game.getPendingDamage() });
    return index;
  }
  async function decide(original) {
    engineRequests++;
    const playerId = decisionPlayer(original);
    // Other seats are inert targets; their overflowing cards remain hidden.
    if (playerId !== 0 && !poisonTurn && !config.normalOpening) {
      if (original.type !== 'overflow') throw new Error(`Unexpected target decision: ${original.type}`);
      return game.resolveOverflowWithDecisions(playerId,
        Array.from({ length: game.player(playerId).hand.length-game.player(playerId).handLimit }, (_, i) => i), options);
    }
    // The prescribed opening must deliver both one-point hits. Other healing
    // decisions (including rebound self-damage) remain learned decisions.
    if (!config.unrestrictedChoices && !poisonTurn && original.type === 'healing' && original.context?.skillId === 'arcaneCodex' && original.context.amount === 1) return 0;
    let request = original;
    if (!config.unrestrictedChoices && request.skillId === 'spellRebound' && request.type === 'cardChoice' && (!poisonTurn || (request.context?.sourceId === 1 && game.turn.state?.phase === Timing.ACTION_PHASE_BEFORE))) request = { ...request, optional: false };
    if (!config.unrestrictedChoices && !poisonTurn && request.skillId === 'spellRebound' && request.type === 'playerChoice')
      request = { ...request, choices: request.choices.filter(c => c.value === 0 || c.value === 1) };
    const value = await resolveDecision(game, playerId, request, pick);
    if (request.type === 'overflow' && !request.resolveInternally) return game.resolveOverflowWithDecisions(playerId, value, options);
    return value;
  }
  const options = { overflow: 'defer', ...(config.unrestrictedChoices ? {} : {poisonHealing: 0}), choose: decide, chooseResponse: decide,
    chooseTarget: decide, resolveOverflow: decide };
  let truncated = false;
  try {
    await game.beginTurn(0, options, options);
    if (poisonTurn || config.normalOpening) {
      while (game.turn.needsAction()) {
        engineRequests++;
        const action = await resolveDecision(game,0,{type:'action'},pick);
        rootActions.push(action.type==='skill'?action.skillId:action.type);
        if (action.type==='pass') game.skipExtraActions(0);
        else if (action.type==='activate') await game.activateAsync(0,{...options,intent:action.intent});
        else {
          try { await game.executeAction(0,action,options); }
          catch(error) { if(!error.actionInvalidated)throw error; }
        }
      }
      if (!game.winner) await game.endTurnWithDecisions(options);
    } else {
    const hand = game.player(0).hand, candidates = [];
    for (let i = 0; i < hand.length; i++) for (let j = i+1; j < hand.length; j++) {
      if (distinctElements(game, 0, [hand[i], hand[j]])) candidates.push({
        type: 'skill', skillId: 'arcaneCodex', cardIds: [hand[i].id, hand[j].id], targetIds: [0],
      });
    }
    // One-element hands cannot legally start this exercise; report, don't fake a loss.
    if (candidates.length) {
      const request = { type: 'action', skillId: 'arcaneCodex' };
      engineRequests++;
      const index = await pick({ game, playerId: 0, request, candidates });
      await game.executeAction(0, candidates[index], options);
    }
    }
    game.assertCardLocations();
    if (game.getPendingDamage().length || game.players.some(p => p.pendingOverflow)) throw new Error('Unsettled drill resolution');
  } catch (error) {
    if (error === limit) truncated = true;
    else {
      const directory = process.env.XINGBEI_DIAGNOSTIC_DIR;
      if (directory) {
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, `sage-${seed}-${Date.now()}.json`), JSON.stringify({
          config, initialCards, trace, error: error.stack, cards: [...game.cards.values()],
          deck: game.deck.map(c => c.id), players: game.players, teams: game.teams,
          turn: game.turn.state, log: game.log, pendingDamage: game.getPendingDamage(),
        }, null, 2));
      }
      throw error;
    }
  }
  ownMoraleLoss = 15 - Math.min(minimumOwnMorale, game.teams.red.morale);
  const eligible = poisonTurn || config.normalOpening || distinct >= 2;
  const feasible = !truncated && eligible && ownMoraleLoss <= lossBudget && game.winner !== 'blue';
  const enemyMoraleLoss = 15-game.teams.blue.morale;
  const usefulDamage = poisonTurn ? enemyMoraleLoss : Math.min(15, enemySpellDamage);
  const endingGems = game.player(0).energy.gem;
  const continuationBonus = eligible && !truncated && feasible && endingGems>0 ? gemRetentionBonus : 0;
  const rawScore = usefulDamage+continuationBonus;
  return { seed, exercise, observationContract: DAMAGE_PLAN_CONTRACT,
    initialGems, gemRetentionBonus, endingGems, continuationBonus, rawScore, rewardScale, gemSpent, gemGained, wisdomTriggers,
    signature, initialCards, directDamage, eligible, feasible, lossBudget, ownMoraleLoss, enemyMoraleLoss, rootActions,
    enemySpellDamage, usefulDamage, reboundCount, decisions, engineRequests, replayedEngineRequests: 0,
    // A completed exercise is not a completed game. Never feed this into win/loss training_samples.
    terminated: !truncated && eligible, truncated, winner: game.winner,
    drillReturn: !eligible || truncated ? null : feasible ? rawScore/rewardScale : -1,
    final: { hand: game.player(0).hand.length, healing: game.player(0).healing,
      gem: game.player(0).energy.gem, poisonCount: game.player(0).getStatus("poison").length, turnEnded: game.turn.state === null, ownMorale: game.teams.red.morale, enemyMorale: game.teams.blue.morale },
    ...(capture ? { trace, log: game.log } : {}), elapsedMs: performance.now()-started };
}
