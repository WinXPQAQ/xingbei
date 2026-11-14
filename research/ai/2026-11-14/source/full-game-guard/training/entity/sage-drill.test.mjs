import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../src/engine.js';
import { resolveSync } from '../../src/resolution/decisions.js';
import { createEntityEncoder } from './observation.mjs';
import { driveSageDrill } from './sage-drill.mjs';

test('declared damage queue preserves resolution and clears on close/victory', () => {
  const run = queued => {
    const game = new Game({seed:4,heroRules:false}).setup(1);
    const hits=[{targetId:1,amount:1},{targetId:0,amount:2}];
    function* old() {for(const hit of hits) yield* game.damageSteps(hit.targetId,hit.amount,{sourceId:0,damageType:'spell'});}
    resolveSync(queued ? game.damageSequenceSteps(hits,{sourceId:0,damageType:'spell'}) : old(), req=>game.automaticDecision(req));
    assert.equal(game.getPendingDamage().length,0);
    return {hands:game.players.map(p=>p.hand.map(c=>c.id)),teams:game.teams,deck:game.deck.map(c=>c.id),timeline:game.timeline};
  };
  assert.deepEqual(run(true),run(false));
  const game=new Game({seed:9,heroRules:false}).setup(6);
  game.player(1).healing=1;
  const steps=game.damageSequenceSteps([{targetId:1,amount:1},{targetId:0,amount:2}],{sourceId:0,damageType:'spell'});
  assert.equal(steps.next().done,false);assert.equal(game.getPendingDamage().length,1);
  steps.return();assert.equal(game.getPendingDamage().length,0);
  game.player(1).healing=0;game.teams.blue.morale=1;
  resolveSync(game.damageSequenceSteps([{targetId:1,amount:1},{targetId:0,amount:2}],{sourceId:0,damageType:'spell'}),r=>game.automaticDecision(r));
  assert.equal(game.winner,'red');assert.equal(game.getPendingDamage().length,0);assert.equal(game.teams.red.morale,15);
});

test('Sage exercise exposes nested public continuations, not hidden cards; failures are not wins',async()=>{
  const encode=createEntityEncoder();let sawNested=false,checkedPrivacy=false,sawSkill=false;
  const result=await driveSageDrill({seed:41,capture:true},async input=>{
    const observation=encode(input);
    const queue=observation.entities.filter(e=>e.kind==='pendingDamage');
    if(queue.length>=2){
      sawNested=true;
      assert.deepEqual(queue.map(e=>[e.categorical.skill,e.numbers.amount]),input.game.getPendingDamage().map(h=>[h.skillId,h.amount]));
      assert(queue.every((e,i)=>e.numbers.order===i));
    }
    if(input.request.type==='healing'){
      assert.equal(observation.entities[observation.question].categorical.skill,input.request.context.skillId);sawSkill=true;
    }
    if(!checkedPrivacy){
      const g=input.game;const deck=[...g.deck],other=[...g.player(1).hand];
      // Change hidden identities as well as future order; preserve public counts.
      const a=g.deck.at(-1),b=g.player(1).hand[0];
      g.moveCard(a.id,{zone:'hand',playerId:1},{animate:false});g.moveCard(b.id,{zone:'deck'},{animate:false});
      g.deck.reverse();
      assert.deepEqual(createEntityEncoder()(input),observation);
      g.moveCard(b.id,{zone:'hand',playerId:1},{animate:false});g.moveCard(a.id,{zone:'deck'},{animate:false});
      g.deck.sort((a,b)=>deck.indexOf(a)-deck.indexOf(b));g.player(1).hand.sort((a,b)=>other.indexOf(a)-other.indexOf(b));
      checkedPrivacy=true;
    }
    return 0;
  });
  assert(sawNested&&checkedPrivacy&&sawSkill);
  assert(result.ownMoraleLoss>0);assert.equal(result.drillReturn,-1);assert.equal(result.feasible,false);
  const opening=result.trace[0].candidates[result.trace[0].index];
  assert.equal(opening.skillId,'arcaneCodex');assert.equal(opening.cardIds.length,2);assert.deepEqual(opening.targetIds,[0]);
  const replay=await driveSageDrill({seed:41},async()=>0);
  for(const field of ['signature','enemySpellDamage','ownMoraleLoss','reboundCount','final']) assert.deepEqual(result[field],replay[field]);
});

test('poison exercise follows real pre-action damage through a free action and turn end with visible risk budget',async()=>{
  const {SAGE_POISON_DRILL,makeSageDrill}=await import('./sage-drill.mjs');
  const {teacherIndex}=await import('../teacher.mjs');
  const initial=makeSageDrill(51,SAGE_POISON_DRILL);
  assert.equal(initial.player(0).hand.length,5);assert.equal(initial.player(0).energy.gem,2);
  assert.equal(initial.player(0).healing,2);assert.equal(initial.player(0).getStatus('poison').length,1);
  let reboundBeforeAction=false,seenAction=false;
  const encoder=createEntityEncoder();
  const result=await driveSageDrill({seed:51,exercise:SAGE_POISON_DRILL,lossBudget:2,capture:true},input=>{
    const obs=encoder(input),question=obs.entities[obs.question];
    assert.equal(question.numbers.maxOwnMoraleLoss,2);
    if(input.request.type==='action')seenAction=true;
    if(input.request.skillId==='spellRebound'&&!seenAction)reboundBeforeAction=true;
    return teacherIndex(input,'v1.17.0-preview.5');
  });
  assert(reboundBeforeAction&&seenAction);
  assert.equal(result.final.poisonCount,0);assert.equal(result.final.turnEnded,true);
  assert(result.rootActions.includes('arcaneCodex'));
  assert.equal(result.enemyMoraleLoss,15-result.final.enemyMorale);
  assert.equal(result.drillReturn,result.enemyMoraleLoss/15);
});

test('empty-energy magic archer commits two gems in heuristic and model paths without changing human legality',async()=>{
  const {forcedMagicArcherRefine}=await import('../../src/heroes/magic-archer/ai.js');
  const {chooseAiAction}=await import('../../src/ai.js');
  const {resolveDecision}=await import('../decision-runner.mjs');
  const {actionCandidates}=await import('../candidates.mjs');
  const game=new Game({seed:31,playerHeroId:'magicArcher'}).setup();
  game.startTurn(0);game.addStones('red','gem',2);
  const expected={type:'refine',stones:{gem:2,crystal:0}};
  assert.deepEqual(chooseAiAction(game,0),expected);
  assert(actionCandidates(game,0).length>1);
  const action=await resolveDecision(game,0,{type:'action'},input=>{
    assert.equal(input.candidates.length,1);assert(input.request.required);return 0;
  });
  assert.deepEqual(action,expected);
  game.player(0).energy.crystal=1;assert.equal(forcedMagicArcherRefine(game,0),null);
  game.player(0).energy.crystal=0;
  await game.activateAsync(0,{choose:()=>false});
  assert.equal(forcedMagicArcherRefine(game,0),null);
});

test('energized magic archer masks buying, commits an activation and spends crystals first only for AI',async()=>{
  const {chooseAiAction,chooseAiRuleDecision}=await import('../../src/ai.js');
  const {resolveDecision}=await import('../decision-runner.mjs');
  const {actionCandidates,decisionPlayer}=await import('../candidates.mjs');
  const {teacherIndex}=await import('../teacher.mjs');
  const make=(count,energy={gem:1,crystal:1})=>{
    const game=new Game({seed:31,playerHeroId:'magicArcher'}).setup(count);
    game.startTurn(0);Object.assign(game.player(0).energy,energy);game.addStones('red','gem',3);return game;
  };
  for(const count of [0,1,2]) {
    const game=make(count);
    assert(actionCandidates(game,0).some(c=>c.type==='purchase'));
    assert(actionCandidates(game,0).some(c=>c.type==='synthesize'));
    for(const hierarchical of [true,false]) {
      await resolveDecision(game,0,{type:'action'},input=>{
        if(!input.request.stage||input.request.stage==='direction') {
          for(const type of ['purchase','synthesize'])
            assert.equal(input.candidates.some(c=>(c.direction??c.type)===type),count<2);
        }
        return 0;
      },{hierarchical});
      // Both current and historical teachers must map into the filtered tree.
      for(const version of ['v1.5','v1.17.0-preview.5']) {
        const action=await resolveDecision(game,0,{type:'action'},input=>teacherIndex(input,version),{hierarchical});
        if(count===2)assert(!['purchase','synthesize'].includes(action.type));
      }
    }
    if(count===2)assert(!['purchase','synthesize'].includes(chooseAiAction(game,0).type));
  }
  for(const energy of [{gem:0,crystal:1},{gem:1,crystal:0},{gem:1,crystal:1}]) {
    const game=make(2,energy), accepted=[];
    await game.activateAsync(0,{choose:request=>resolveDecision(game,decisionPlayer(request),request,input=>{
      if(request.type==='skillChoice'&&['charge','magicEye'].includes(request.skillId)) {
        // Try to decline every activation: only the first of two may decline.
        const index=input.candidates.includes(false)?input.candidates.indexOf(false):0;
        const value=input.candidates[index];
        if(value)accepted.push(request.skillId);
        if(request.skillId==='magicEye'||energy.gem===0) {
          assert.equal(value,true);assert.equal(chooseAiRuleDecision(request,game),true);
        }
        return index;
      }
      return teacherIndex(input,'v1.17.0-preview.5');
    })});
    assert.deepEqual(accepted,[energy.gem?'magicEye':'charge']);
    assert.equal(game.player(0).hero.state.charged,energy.gem===0);
    if(energy.gem)assert.equal(game.player(0).covered.length,1);
  }
  const game=make(2), steps=game.paySkillEnergy(0,'crystal',1,{skillId:'charge',alwaysChoose:true});
  const request=steps.next().value;
  assert.equal(request.choices.length,2); // Humans may still pay either resource.
  const payment=await resolveDecision(game,0,request,input=>{
    assert.deepEqual(input.candidates,[{gem:0,crystal:1}]);return 0;
  });
  assert.deepEqual(chooseAiRuleDecision(request,game),payment);
  steps.next(payment);assert.deepEqual(game.player(0).energy,{gem:1,crystal:0});
  game.turn.state.phase='activation';
  const blocked={type:'skillChoice',playerId:0,skillId:'magicEye',blockedReason:'blocked',choices:[{value:false}]};
  assert.equal(await resolveDecision(game,0,blocked,()=>0),false);
});

test('one-gem continuation bonus is terminal, separate from damage, and never paid in two-gem cases',async()=>{
  const {SAGE_POISON_DRILL}=await import('./sage-drill.mjs');
  const {teacherIndex}=await import('../teacher.mjs');
  const encoder=createEntityEncoder();
  async function play(initialGems,spend){
    return driveSageDrill({seed:51,exercise:SAGE_POISON_DRILL,initialGems,
      gemRetentionBonus:initialGems===1?4:0,rewardScale:19,lossBudget:3},input=>{
      const question=encoder(input).entities.find(e=>e.kind==='question');
      assert.equal(question.numbers.initialGems,initialGems);
      assert.equal(question.numbers.gemRetentionBonus,initialGems===1?4:0);
      if(!spend&&input.playerId===0&&input.request.type==='action'){
        const index=input.candidates.findIndex(c=>c.direction==='attack');return index<0?0:index;
      }
      return teacherIndex(input,'v1.17.0-preview.5');
    });
  }
  const kept=await play(1,false),spent=await play(1,true),two=await play(2,false);
  assert(kept.final.turnEnded&&spent.final.turnEnded&&two.final.turnEnded);
  assert.equal(kept.endingGems,1);assert.equal(kept.continuationBonus,4);
  assert.equal(kept.rawScore,kept.enemyMoraleLoss+4);
  assert.equal(kept.drillReturn,kept.rawScore/19);
  assert.equal(spent.endingGems,0);assert.equal(spent.continuationBonus,0);
  assert.equal(two.endingGems,2);assert.equal(two.continuationBonus,0);
  assert.equal(two.drillReturn,two.enemyMoraleLoss/19);
  assert.equal(kept.enemyMoraleLoss,two.enemyMoraleLoss);
});
