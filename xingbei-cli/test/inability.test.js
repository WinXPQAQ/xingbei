import test from 'node:test';
import assert from 'node:assert/strict';
import { Game,Timing } from '../src/engine.js';
import { safeRemovalSets, overflowChoices, safePaidRemovalChoices } from '../src/inability.js';
import { buildDecisionSpace } from '../training/decision-space.mjs';
import { decisionCandidates } from '../training/candidates.mjs';
import { chooseAiDiscard, chooseAiRuleDecision } from '../src/ai.js';
import { forkActivationGame } from '../src/resolution/activation-guard.js';
const ids=['magicSwordsman','beastWarrior','berserker','headMaid','priest','marksman'];
test('activation choices prove empty-hand continuations without paying costs or reading hidden faces',async()=>{
 for(const hero of ['magicSwordsman','redLotusKnight'])for(const hidden of ['waterStrike','holyLight']){
  const game=new Game({seed:9,heroIds:[hero,'none','none','gluttonousGirl','none','none']});
  const bullet=game.deck.find(c=>c.name==='magicBullet');game.moveCard(bullet.id,{zone:'hand',playerId:3});
  game.moveCard(game.deck.find(c=>c.name===hidden).id,{zone:'hand',playerId:1});
  game.player(0).healing=hero==='redLotusKnight'?4:0;game.startTurn(0);
  const before=JSON.stringify([...game.cards.values()]);const fork=forkActivationGame(game);fork.assertCardLocations();
  assert.equal(JSON.stringify([...game.cards.values()]),before);
  let checked=false;
  await game.activateAsync(0,{choose:r=>{
   if(r.skillId==='appetiteBlackHole'){
    checked=true;assert.deepEqual(r.validSets,[]);assert.deepEqual(r.activationBlockedChoices,[[0]]);
    assert.equal(bullet.location.zone,'hand');assert.match(r.title,/无法行动/);return null;
   }
   if(r.type==='skillChoice')return r.blockedReason?false:true;
   if(r.skillId==='bloodPrayer'&&r.type==='numberChoice')return 4;
   return r.defaultValue??r.choices?.[0]?.value;
  }});
  assert.ok(checked);assert.equal(game.winner,null);assert.ok(game.player(0).hand.length>0);
  assert.equal(bullet.location.zone,'hand');game.assertCardLocations();
 }
});

test('an actual interrupted activation draw records the responsible responder',async()=>{
 const game=new Game({seed:12,heroIds:['magicSwordsman','none','none','gluttonousGirl','none','none']});
 const bullet=game.deck.find(c=>c.name==='magicBullet');game.moveCard(bullet.id,{zone:'hand',playerId:3});
 game.startTurn(0);
 // Bypass preventive filtering only to exercise the terminal fallback shared
 // by historical replays. The ordinary entry above must never offer this cost.
 const {resolveAsync}=await import('../src/resolution/decisions.js');
 await resolveAsync(game.turn.activateUnchecked(0,{}),r=>{
  if(r.skillId==='appetiteBlackHole')return [0];
  if(r.type==='skillChoice')return true;
  return r.defaultValue??r.choices?.[0]?.value;
 });
 assert.equal(game.winner,'blue');assert.equal(game.inabilityArchives[0].responsiblePlayerId,3);
 assert.equal(game.inabilityArchives[0].targetId,0);assert.equal(game.inabilityArchives[0].skillId,'appetiteBlackHole');
 assert.equal(game.inabilityArchives[0].players.length,6);game.assertCardLocations();
});
function setup(names){
 const game=new Game({heroIds:ids,seed:123}).setup();
 for(const card of [...game.player(0).hand])game.moveCard(card.id,{zone:'outside'});
 for(const name of names){const card=game.deck.find(c=>name==='attack'?c.type==='attack':c.type==='spell');game.moveCard(card.id,{zone:'hand',playerId:0});}
 game.player(0).hero.state.form='暗影';
 game.turn.state={playerId:0,activationDone:true,completed:false,actionType:null,skipped:false,phase:Timing.ACTIVATION,usedSkills:{},pendingActions:[]};
 return game;
}
test('known loss of entire hand is blocked; hidden faces never determine enemy target legality',()=>{
 const one=setup(['attack']);assert.equal(one.knownRemovalBlocked(1,0,1),true);
 const two=setup(['attack','spell']);assert.equal(two.knownRemovalBlocked(1,0,1),false);
 assert.deepEqual(safeRemovalSets(two,0,1),[[1]]);
 const iterator=two.chooseHandCards(0,1,()=>true,{preserveAction:true});
 const request=iterator.next().value;assert.deepEqual(request.validSets,[[1]]);
 assert.throws(()=>iterator.next([0]),/你将无法行动/);
 assert.equal(two.player(0).hand.length,2);
});
test('actual malicious inability records responsible side and a detached complete archive',()=>{
 const game=setup(['attack']);const card=game.player(0).hand[0];
 game.moveCard(card.id,{zone:'discard'},{visibility:'public'});
 assert.equal(game.forfeitMaliciousInability(1,'beastVigilance',0,{knownHandCount:1,removedCardId:card.id}),true);
 assert.equal(game.winner,'red');
 const record=game.inabilityArchives[0];assert.equal(record.responsiblePlayerId,1);assert.equal(record.players.length,6);
 assert.ok(record.cards.length>=150);assert.ok(record.log.some(x=>x.includes('恶意无法行动')));
 game.log.push('later');assert.ok(!record.log.includes('later'));
});

test('activation overflow and War God Body preserve an actionable retention before committing', async () => {
  const cases = [
    { hero: 'magicLancer', form: 'phantom', limit: 5, names: ['waterStrike', 'weakness', 'weakness', 'magicBullet', 'magicBullet', 'poison'], unsafe: [0] },
    { hero: 'azureFlameWitch', form: 'flame', limit: 2, names: ['windStrike', 'holyLight', 'holyLight'], unsafe: [0] },
    { hero: 'azureFlameWitch', form: 'flame', limit: 3, names: ['darkStrike', 'earthStrike', 'holyLight', 'holyLight', 'holyLight'], unsafe: [0, 1] },
    { hero: 'heretic', limit: 5, names: ['waterStrike', ...Array(5).fill('holyLight')], unsafe: [0] },
  ];
  for (const entry of cases) {
    const game = new Game({ heroIds: [entry.hero, 'none', 'none', 'none', 'none', 'none'], seed: 123 });
    const player = game.player(0);
    const baseLimit = player.handLimit;
    player.energy = { gem: 0, crystal: 0 };
    if (entry.form) player.hero.state.form = entry.form;
    if (entry.hero === 'magicLancer') player.hero.state.released = true;
    player.handLimit = baseLimit + entry.limit - player.handLimit;
    for (const name of entry.names) game.moveCard(game.deck.find(card => card.name === name).id, { zone: 'hand', playerId: 0 });
    game.turn.state = { playerId: 0, activationDone: true, completed: false, actionType: null,
      skipped: false, phase: Timing.ACTIVATION, usedSkills: {}, pendingActions: [] };
    player.pendingOverflow = { moraleLoss: true };
    const before = player.hand.map(card => card.id), morale = game.teams.red.morale;
    const choices = overflowChoices(game, 0), request = { type: 'overflow', player };
    assert.equal(choices.canSelect(entry.unsafe), false, entry.hero);
    assert.throws(() => game.resolveOverflow(0, entry.unsafe), /你将无法行动/);
    assert.deepEqual(player.hand.map(card => card.id), before);
    assert.equal(game.teams.red.morale, morale);
    assert.ok(player.pendingOverflow);
    assert.ok(decisionCandidates(game, request).every(choices.canSelect));
    const visit = space => {
      if (space.done) { assert.ok(choices.canSelect(space.value)); return; }
      for (const value of space.candidates) visit(space.next(value));
    };
    visit(buildDecisionSpace(game, 0, request));
    const selected = chooseAiDiscard(game, 0, choices.count);
    assert.ok(choices.canSelect(selected));
    game.resolveOverflow(0, selected);
    assert.ok(game.hasOrdinaryContinuation(0));
    assert.equal(game.winner, null);
    game.assertCardLocations();
    // The same cards can be discarded after the action, or when an independent
    // skill supplies the continuation. Unlucky all-light hands remain refreshable.
    for (const id of before) game.moveCard(id, { zone: 'hand', playerId: 0 });
    game.turn.state.completed = true;
    assert.ok(overflowChoices(game, 0).canSelect(entry.unsafe));
    game.turn.state.completed = false;
    player.hero.addSkills({ id: 'freeContinuation', name: 'Action fixture', action: () => ({ type: 'spell', targetCount: 0 }), *resolveAction() {} });
    assert.ok(overflowChoices(game, 0).canSelect(entry.unsafe));
    player.hero.removeSkill('freeContinuation');
    for (const card of [...player.hand]) if (card.type === 'attack') game.moveCard(card.id, { zone: 'outside' });
    player.handLimit -= 1;
    const unlucky = overflowChoices(game, 0);
    assert.ok(unlucky.canSelect(unlucky.valid.slice(0, unlucky.count)));
  }
  for (const reject of [true, false]) {
    const game = new Game({ heroIds: ['fighter', 'none', 'none', 'none', 'none', 'none'], seed: 123 });
    const player = game.player(0);
    for (const name of ['thunderStrike', 'fireStrike', 'windStrike', 'holyLight', 'holyLight', 'holyLight'])
      game.moveCard(game.deck.find(card => card.name === name).id, { zone: 'hand', playerId: 0 });
    player.energy.gem = 1;
    game.startTurn(0);
    const action = () => game.executeAction(0, { type: 'activate' }, { choose: request => {
      if (request.type === 'skillChoice') return request.skillId === 'warGodBody';
      if (request.type === 'cardChoice') {
        assert.ok(request.validSets.every(set => [0, 1, 2].some(index => !set.includes(index))));
        return reject ? [0, 1, 2] : chooseAiRuleDecision(request, game);
      }
      return request.defaultValue;
    } });
    if (reject) {
      await assert.rejects(action, /你将无法行动/);
      assert.equal(player.hand.length, 6);
    } else {
      await action();
      assert.equal(player.hand.length, 3);
      assert.ok(game.hasOrdinaryContinuation(0));
      assert.equal(player.healing, 2);
      assert.equal(game.winner, null);
      game.assertCardLocations();
    }
  }
});
test('unlucky activation redraws until actionable without a second activation',()=>{
 const game=setup(['spell']);game.turn.state.randomActivationDraw=true;
 // Last deck card is drawn first: one further unusable spell, then an attack.
 const attack=game.deck.find(c=>c.type==='attack'), spell=game.deck.find(c=>c.type==='spell');
 game.moveCard(attack.id,{zone:'outside'});game.moveCard(spell.id,{zone:'outside'});
 game.moveCard(attack.id,{zone:'deck'});game.moveCard(spell.id,{zone:'deck'});
 const steps=game.restoreRandomInability(0);let step=steps.next();
 while(!step.done){assert.ok(['presentation'].includes(step.value.type));step=steps.next();}
 assert.equal(game.player(0).hand.length,1);assert.equal(game.player(0).hand[0].type,'attack');
 assert.equal(game.turn.state.activationDone,true);assert.equal(game.winner,null);
 assert.equal(game.log.filter(x=>x.includes('无法行动，展示')).length,2);
});

test('recorded ownership attributes an unsafe personal discard to the chooser, not the forcing hero',()=>{
 const game=setup(['attack','spell']);
 game.activeTrigger={ownerId:1,skillId:'beastVigilance'};
 // Simulate an old caller which did not request pre-filtering; post-check remains a backstop.
 const choice=game.chooseHandCards(0,1);choice.next();const selected=choice.next([0]).value;
 game.discardCards(0,selected);
 assert.equal(game.turn.state.inabilityCause.actorId,0);
 const steps=game.restoreRandomInability(0);let step=steps.next();while(!step.done)step=steps.next();
 assert.equal(game.winner,'blue');assert.equal(game.inabilityArchives[0].responsiblePlayerId,0);
});

test('explicit activation blocks spending the sole action energy, then permits a fresh spell choice',async()=>{
 for(const [heroId,skillId,field,actionId] of [
  ['inquisitor','adjudicate','rulings','divineSpur'],
  ['holyAdjudicator','heavenSin','sins','sinArrives'],
 ])for(const energy of ['gem','crystal']){
  const g=new Game({heroIds:[heroId,'none','none','none','none','none']});
  const p=g.player(0);p.hero.state[field]=2;p.energy[energy]=1;
  g.startTurn(0);
  let offered=false;
  await g.executeAction(0,{type:'activate'},{choose:r=>{
    if(r.skillId===skillId){offered=true;assert.equal(r.blockedReason,'你将无法行动');assert.deepEqual(r.choices.map(c=>c.value),[false]);return true;}
    return r.defaultValue;
  }});
  assert.ok(offered);assert.equal(p.energy[energy],1);assert.equal(p.hero.state[field],2);
  assert.equal(g.turn.state.activationDone,true);assert.equal(g.turn.state.actionType,null);
  assert.ok(g.legalSkillActions(0).some(x=>x.skillId===actionId));
  assert.equal(g.canDrawSpecial(0),false);assert.equal(g.canActivate(0),false);
  assert.equal(g.winner,null);g.assertCardLocations();
 }
});

test('activation requires an ordinary continuation or an explicitly declared supplying route',()=>{
 const priest=new Game({heroIds:['priest','none','none','none','none','none']});
 priest.player(0).energy.crystal=1;priest.player(0).healing=1;priest.startTurn(0);
 assert.equal(priest.canActivate(0),false);assert.equal(priest.canDrawSpecial(0),true);
 const swordsman=new Game({heroIds:['magicSwordsman','none','none','none','none','none']});swordsman.startTurn(0);
 assert.equal(swordsman.canActivate(0),true);
 const steps=swordsman.activateSteps(0),route=steps.next().value;
 assert.equal(route.skillId,'activationRoute');assert.deepEqual(route.choices.map(c=>c.value),['shadowGathering']);
 let step=steps.next('shadowGathering');
 while(!step.done&&step.value.type==='presentation')step=steps.next();
 assert.equal(step.value.skillId,'shadowGathering');assert.equal(step.value.required,true);
 assert.deepEqual(step.value.choices.map(c=>c.value),[true]);steps.return();
});

test('preaching excludes undeliverable blades from supply and preserves terminal priority', async () => {
  for (const mode of ['safe', 'onlyBladesEmpty', 'onlyBladesRetained', 'unusableDonation', 'retainedHand', 'skillContinuation', 'legacyCaller', 'terminalDamage']) {
    const game = new Game({ heroIds: ['missionary', 'godEater', 'none', 'none', 'none', 'none'], seed: 123 });
    const missionary = game.player(0), donor = game.player(1);
    missionary.hero.state.started = true;
    game.attachCard('waypoint:0', donor.id, { effectId: 'waypoint', sourcePlayerId: missionary.id });
    const blade = game.cards.get('alienBlade-1');
    game.moveCard(blade.id, { zone: 'hand', playerId: donor.id });
    const onlyBlades = mode === 'onlyBladesEmpty' || mode === 'onlyBladesRetained';
    const ordinary = game.deck.find(card => mode === 'unusableDonation' ? card.name === 'holyLight' : card.type === 'attack');
    if (!onlyBlades) game.moveCard(ordinary.id, { zone: 'hand', playerId: donor.id });
    if (mode === 'retainedHand' || mode === 'onlyBladesRetained') {
      game.moveCard(game.deck.find(card => card.type === 'attack').id, { zone: 'hand', playerId: missionary.id });
    }
    if (mode === 'skillContinuation') {
      missionary.energy.gem = 1;
      missionary.hero.addSkills({
        id: 'availableSpell', name: 'Public action fixture',
        action: () => ({ type: 'spell', energy: 'gem', targetCount: 0 }),
        *resolveAction() {},
      });
    }
    const drawn = game.deck.find(card => card.name === 'holyLight');
    game.moveCard(drawn.id, { zone: 'outside' });
    game.moveCard(drawn.id, { zone: 'deck' });
    const bypass = mode === 'legacyCaller' || mode === 'terminalDamage';
    if (bypass) {
      // Exercise the postcondition for callers predating the selection restriction.
      const chooseHandCards = game.chooseHandCards;
      game.chooseHandCards = function* (playerId, count, predicate, options) {
        if (options?.skillId === 'preachingRecipient') return [blade];
        return yield* chooseHandCards.call(this, playerId, count, predicate, options);
      };
    }
    if (mode === 'terminalDamage') {
      donor.handLimit = 1;
      game.teams.blue.morale = 1;
    }
    game.startTurn(missionary.id);
    if (mode === 'onlyBladesEmpty') {
      assert.equal(game.canActivate(missionary.id), false);
      assert.ok(!game.activationSuppliers(missionary.id).some(skill => skill.id === 'preaching'));
      game.assertCardLocations();
      continue;
    }
    let selected = false;
    await game.activateAsync(missionary.id, { choose: request => {
      if (request.skillId === 'preaching') return true;
      if (request.skillId === 'preachingDraw') {
        if (mode === 'onlyBladesRetained') assert.deepEqual(request.choices.map(choice => choice.value), [1]);
        return 1;
      }
      if (request.skillId === 'preachingCost') {
        if (mode === 'onlyBladesRetained') assert.deepEqual(request.valid, [missionary.hand.indexOf(drawn)]);
        return [missionary.hand.indexOf(drawn)];
      }
      if (request.skillId === 'preachingRecipient') {
        selected = true;
        const expected = mode === 'onlyBladesRetained' ? [0] : mode === 'retainedHand' ? [0, 1] : [1];
        assert.deepEqual(request.valid, expected, mode);
        return [expected[0]];
      }
      return request.defaultValue;
    } });
    assert.equal(selected, !bypass, mode);
    if (mode === 'legacyCaller') {
      assert.equal(game.winner, 'red');
      const archive = game.inabilityArchives[0];
      assert.equal(archive.responsiblePlayerId, donor.id);
      assert.equal(archive.targetId, missionary.id);
      assert.equal(archive.evidence.cardId, blade.id);
      assert.equal(archive.players.length, 6);
      assert.ok(archive.cards.length >= 150);
      assert.ok(!game.auditTrail.some(event => event.type === 'activationRefreshAllowed'));
    } else {
      assert.equal(game.winner, mode === 'terminalDamage' ? 'red' : null, mode);
      assert.equal(game.inabilityArchives.length, 0, mode);
    }
    if (mode === 'safe' || mode === 'skillContinuation') assert.ok(missionary.hand.includes(ordinary));
    if (mode === 'retainedHand' || mode === 'onlyBladesRetained' || bypass) assert.equal(blade.location.zone, 'outside', mode);
    if (mode === 'unusableDonation') {
      assert.equal(blade.location.zone, 'hand');
      assert.ok(game.log.some(entry => entry.includes('无法行动，展示')));
      assert.ok(game.legalCards(missionary.id).length);
    }
    game.assertCardLocations();
  }
  for (const mode of ['empty', 'retainedHand', 'skillContinuation']) {
    const game = new Game({ heroIds: ['missionary', 'none', 'gluttonousGirl', 'none', 'none', 'none'], seed: 123 });
    const missionary = game.player(0), donor = game.player(1), claimant = game.player(2);
    missionary.hero.state.started = true;
    game.attachCard('waypoint:0', donor.id, { effectId: 'waypoint', sourcePlayerId: missionary.id });
    const donation = game.deck.find(card => card.name === 'magicBullet');
    game.moveCard(donation.id, { zone: 'hand', playerId: donor.id });
    const seal = game.deck.find(card => card.name === 'holyShield');
    game.attachCard(seal.id, donor.id, { effectId: `${donation.element}Seal`, sourcePlayerId: 4 });
    game.moveCard(game.deck.find(card => card.type === 'attack').id, { zone: 'hand', playerId: claimant.id });
    if (mode === 'retainedHand') {
      game.moveCard(game.deck.find(card => card.type === 'attack').id, { zone: 'hand', playerId: missionary.id });
    }
    if (mode === 'skillContinuation') {
      missionary.energy.gem = 1;
      missionary.hero.addSkills({
        id: 'availableSpell', name: 'Public action fixture',
        action: () => ({ type: 'spell', energy: 'gem', targetCount: 0 }),
        *resolveAction() {},
      });
    }
    const drawn = game.deck.find(card => card.name === 'holyLight');
    game.moveCard(drawn.id, { zone: 'outside' });
    game.moveCard(drawn.id, { zone: 'deck' });
    game.startTurn(missionary.id);
    let offered = false;
    await game.activateAsync(missionary.id, { choose: request => {
      if (request.skillId === 'preaching') return true;
      if (request.skillId === 'preachingDraw') return 1;
      if (request.skillId === 'preachingCost') return [missionary.hand.indexOf(drawn)];
      if (request.skillId === 'preachingRecipient') return [donor.hand.indexOf(donation)];
      if (request.skillId === 'threeSecondRule') {
        if (request.type === 'skillChoice') { offered = true; return true; }
        return [0];
      }
      return request.defaultValue;
    } });
    assert.equal(offered, false, mode);
    assert.equal(donation.location.playerId, missionary.id, mode);
    assert.ok(!game.auditTrail.some(event => event.type === 'move' && event.cardId === donation.id && event.to.zone === 'discard'), mode);
    assert.ok(game.log.some(line => line.includes('交给了') && line.includes('魔弹')), mode);
    assert.equal(donor.getStatus(`${donation.element}Seal`).length, 0, mode);
    assert.equal(donor.hand.length, 3, mode);
    assert.ok(game.log.some(line => line.includes('触发【') && line.includes('之封印】')), mode);
    assert.ok(game.hasOrdinaryContinuation(missionary.id), mode);
    assert.equal(game.winner, null);
    game.assertCardLocations();
  }
});

test('empty-handed activation self-damage retains a draw and refreshes unusable cards', async () => {
  for (const heroId of ['redLotusKnight', 'bloodWitch']) for (const mode of ['empty', 'partialHealing', 'unusableDraw', 'retainedHand']) {
    const game = new Game({ heroIds: [heroId, 'none', 'none', 'none', 'none', 'none'], seed: 123 }).setup();
    const player = game.player(0);
    for (const card of [...player.hand]) game.moveCard(card.id, { zone: 'outside' });
    const attack = game.deck.find(card => card.type === 'attack');
    game.moveCard(attack.id, mode === 'retainedHand' ? { zone: 'hand', playerId: 0 } : { zone: 'outside' });
    if (mode !== 'retainedHand') game.moveCard(attack.id, { zone: 'deck' });
    if (mode === 'unusableDraw') {
      const light = game.deck.find(card => card.name === 'holyLight');
      game.moveCard(light.id, { zone: 'outside' });
      game.moveCard(light.id, { zone: 'deck' });
    }
    const witch = heroId === 'bloodWitch';
    if (witch) player.hero.attach(game, player, 1);
    player.healing = !witch && mode === 'partialHealing' ? 4 : 2;
    game.startTurn(0);
    let healingAsked = false;
    await game.activateAsync(0, { choose: request => {
      if (request.type === 'healing') {
        healingAsked = true;
        const allowed = witch && mode === 'retainedHand' ? [0, 1, 2] : [0, 1];
        assert.deepEqual(request.choices.map(choice => choice.value), allowed);
        return allowed.at(-1);
      }
      if (request.skillId === 'bloodPrayer' && request.type === 'numberChoice') return mode === 'partialHealing' ? 2 : 1;
      if (['bloodPrayer', 'bloodSorrow'].includes(request.skillId) && request.type === 'skillChoice') return true;
      if (request.skillId === 'sharedFate' && request.type === 'playerChoice') return 0;
      return request.defaultValue ?? request.choices?.[0]?.value;
    } });
    assert.equal(healingAsked, witch || ['partialHealing', 'retainedHand'].includes(mode));
    assert.equal(player.hand.length, 1);
    assert.ok(game.legalCards(0).length);
    if (witch) assert.equal(player.hero.state.linkedPlayerId, 0);
    else assert.equal(player.hero.state.bloodSeals, 1);
    assert.equal(game.winner, null);
    assert.equal(game.log.some(line => line.includes('无法行动，展示')), mode === 'unusableDraw');
    game.assertCardLocations();
  }
});

test('Spiritual Gift cannot start when its mandatory discard empties the hand', async () => {
  for (const count of [0,1,2]) {
    const game=new Game({heroIds:['missionary','none','none','none','none','none'],seed:123}).setup();
    const player=game.player(0);
    for (const card of [...player.hand]) game.moveCard(card.id,{zone:'outside'});
    for (let i=0;i<count;i++) game.moveCard(game.deck.find(card=>card.name==='poison').id,{zone:'hand',playerId:0});
    player.energy.gem=2;game.startTurn(0);
    const skill=game.activationChoices(0).find(skill=>skill.id==='spiritualGift');
    assert.equal(!!skill.blockedReason,count<=1);
    if(count<=1) {
      await assert.rejects(game.activateAsync(0,{activationSkill:'spiritualGift'}),/你将无法行动/);
      assert.equal(player.hand.length,count);assert.equal(player.energy.gem,2);assert.equal(player.healing,0);
      assert.equal(game.turn.state.activationDone,false);
    }
  }
});

test('empty-handed stealth requires drawing and refreshes an unusable draw', async () => {
  for (const mode of ['attack', 'holyLight', 'retainedHand']) {
    const game = new Game({heroIds:['assassin','none','none','none','none','none'],seed:123}).setup();
    const player = game.player(0);
    for (const card of [...player.hand]) game.moveCard(card.id,{zone:'outside'});
    const attack = game.deck.find(card=>card.type==='attack');
    game.moveCard(attack.id,{zone:'outside'});
    game.moveCard(attack.id,mode==='retainedHand'?{zone:'hand',playerId:0}:{zone:'deck'});
    if (mode==='holyLight') {
      const light=game.deck.find(card=>card.name==='holyLight');
      game.moveCard(light.id,{zone:'outside'});game.moveCard(light.id,{zone:'deck'});
    }
    player.energy.gem=1;player.energy.crystal=2;
    game.startTurn(0);
    let asked=false;
    await game.activateAsync(0,{choose:request=>{
      if(request.skillId==='stealth' && request.type==='skillChoice')return true;
      if(request.skillId==='stealth' && request.type==='numberChoice') {
        asked=true;
        assert.deepEqual(request.choices.map(c=>c.value),mode==='retainedHand'?[0,1]:[1]);
      }
      return request.defaultValue ?? request.choices?.[0]?.value;
    }});
    assert.ok(asked);assert.equal(player.hand.length,1);
    assert.ok(game.hasOrdinaryContinuation(0));assert.equal(player.hero.state.form,'潜行');
    assert.equal(game.log.some(line=>line.includes('无法行动，展示')),mode==='holyLight');
    assert.equal(game.winner,null);game.assertCardLocations();
  }
});

test('a selected action-supplying activation route cannot be skipped', async () => {
  for (const hasAttack of [false, true]) {
    const game = new Game({ heroIds: ['bloodSwordSpirit', 'none', 'none', 'none', 'none', 'none'], seed: 123 }).setup();
    const player = game.player(0);
    for (const card of [...player.hand]) game.moveCard(card.id, { zone: 'outside' });
    if (hasAttack) game.moveCard(game.deck.find(card => card.type === 'attack').id, { zone: 'hand', playerId: 0 });
    player.energy.crystal = 1;
    game.startTurn(0);
    await game.activateAsync(0, { choose: request => {
      if (request.skillId === 'petalDance') {
        assert.deepEqual(request.choices.map(choice => choice.value), hasAttack ? ['skip', 'crystal'] : ['crystal']);
      }
      return request.defaultValue ?? request.choices?.[0]?.value;
    } });
    assert.equal(player.energy.crystal, hasAttack ? 1 : 0);
    assert.equal(player.hero.state.blood, hasAttack ? 0 : 2);
    assert.ok(game.hasOrdinaryContinuation(0));
    game.assertCardLocations();
  }
});

test('Gathering and Phantom Stars preserve the necessary self-damage draw, not every self-damage', async () => {
  for (const hero of ['magicSwordsman','magicLancer']) for (const mode of ['empty','retained','skill','random']) {
    const game=new Game({heroIds:[hero,'none','none','none','none','none'],seed:123});
    const p=game.player(0), skill=hero==='magicSwordsman'?'shadowGathering':'phantomStars';
    if(hero==='magicLancer')p.hero.state.form='phantom';
    p.healing=2;
    const attack=game.deck.find(c=>c.type==='attack');
    game.moveCard(attack.id,mode==='retained'?{zone:'hand',playerId:0}:{zone:'outside'});
    if(mode!=='retained')game.moveCard(attack.id,{zone:'deck'});
    if(mode==='random') {
      const light=game.deck.find(c=>c.name==='holyLight');
      game.moveCard(light.id,{zone:'outside'});game.moveCard(light.id,{zone:'deck'});
    }
    if(mode==='skill') {
      p.energy.gem=1;
      p.hero.addSkills({id:'continuationFixture',name:'Continuation fixture',
        action:()=>({type:'spell',energy:'gem',targetCount:0}),*resolveAction(){}});
    }
    game.startTurn(0);
    let healingChoices=null;
    await game.activateAsync(0,{activationSkill:skill,choose:r=>{
      if(r.type==='healing' && r.playerId===0) {
        healingChoices=r.choices.map(c=>c.value);
        return healingChoices.at(-1);
      }
      if(r.skillId==='phantomStars' && r.type==='playerChoice')return 1;
      return r.defaultValue ?? r.choices?.[0]?.value;
    }});
    const safe=mode==='retained'||mode==='skill';
    assert.deepEqual(healingChoices,hero==='magicSwordsman'?(safe?[0,1]:null):(safe?[0,1,2]:[0,1]),`${hero} ${mode}`);
    assert.equal(p.hand.length,mode==='skill'?0:1);
    assert.ok(game.hasOrdinaryContinuation(0));
    assert.equal(game.winner,null);game.assertCardLocations();
    // Magic Lancer can use the drawn Holy Light as Abundance's spell cost.
    assert.equal(game.log.some(x=>x.includes('无法行动，展示')),mode==='random' && hero==='magicSwordsman');
  }
});

test('Spiritual Gift validates post-payment retention and blocks before any cost', async () => {
  for(const mode of ['attack','spell','blocked','energy']) {
    const game=new Game({heroIds:['missionary','none','none','none','none','none'],seed:123});
    const p=game.player(0);p.hero.state.started=true;
    for(const name of [mode==='attack'?'waterStrike':mode==='spell'?'poison':'holyLight','holyLight'])
      game.moveCard(game.deck.find(c=>c.name===name).id,{zone:'hand',playerId:0});
    p.energy={gem:1,crystal:mode==='energy'?1:0};
    if(mode==='energy')p.hero.addSkills({id:'paidContinuation',name:'Gem continuation',
      action:()=>({type:'spell',energy:'gem',targetCount:0}),*resolveAction(){}});
    game.startTurn(0);
    const before=JSON.stringify([p.hand.map(c=>c.id),p.energy,p.healing,game.turn.state]);
    const projected=safePaidRemovalChoices(game,0,{healingGain:1});
    assert.equal(JSON.stringify([p.hand.map(c=>c.id),p.energy,p.healing,game.turn.state]),before);
    if(mode==='blocked') {
      assert.equal(projected.length,0);
      assert.match(game.activationChoices(0).find(s=>s.id==='spiritualGift').blockedReason,/你将无法行动/);
      await assert.rejects(game.activateAsync(0,{activationSkill:'spiritualGift'}),/你将无法行动|当前不能启动/);
      assert.equal(JSON.stringify([p.hand.map(c=>c.id),p.energy,p.healing,game.turn.state]),before);
      continue;
    }
    if(mode==='energy')assert.deepEqual(projected.map(x=>x.payment),[{gem:0,crystal:1}]);
    await game.activateAsync(0,{activationSkill:'spiritualGift',choose:r=>{
      if(r.skillId==='spiritualGiftCost') {
        assert.deepEqual(r.valid,mode==='energy'?[0,1]:[1]);
        return [r.valid.at(-1)];
      }
      return r.defaultValue ?? r.choices?.[0]?.value;
    }});
    assert.equal(p.hand.length,1);assert.ok(game.hasOrdinaryContinuation(0));
    assert.equal(p.energy.gem,mode==='energy'?1:0);
    assert.equal(game.winner,null);game.assertCardLocations();
  }
});

test('Concerto restricts nested Solo retention and payment but action-end Solo stays legal', () => {
  for(const mode of ['last','onlyUsable','energy','actionEnd']) {
    const game=new Game({heroIds:['orchestraLeader','none','none','none','none','none'],seed:123});
    const p=game.player(0);
    game.moveCard(game.deck.find(c=>c.type==='attack').id,{zone:'hand',playerId:0});
    if(mode==='onlyUsable')game.moveCard(game.deck.find(c=>c.name==='holyLight').id,{zone:'hand',playerId:0});
    p.energy={gem:1,crystal:1};
    game.turn.state={playerId:0,activationDone:true,completed:mode==='actionEnd',actionType:null,skipped:false,phase:Timing.ACTIVATION,usedSkills:{},pendingActions:[]};
    if(mode==='energy')p.hero.addSkills({id:'paidContinuation',name:'Gem continuation',
      action:()=>({type:'spell',energy:'gem',targetCount:0}),*resolveAction(){}});
    const beforeEnergy={...p.energy},steps=p.hero.addNote(game,p,{});
    let step=steps.next(),offered=false;
    while(!step.done) {
      const r=step.value;
      let answer=r.defaultValue;
      if(r.skillId==='naplesSolo') {
        offered=true;
        assert.deepEqual(r.choices.map(c=>c.value),mode==='last'?[false]:[true,false]);
        answer=true; // Even an outdated caller cannot force a blocked skill.
      }
      if(r.skillId==='soloCard') {
        assert.deepEqual(r.valid,mode==='onlyUsable'?[1]:[0]);
        assert.equal(r.purpose,'cover');answer=[r.valid[0]];
      }
      step=steps.next(answer);
    }
    assert.ok(offered);
    assert.equal(p.hand.length,mode==='last'||mode==='onlyUsable'?1:0);
    if(mode==='last')assert.deepEqual(p.energy,beforeEnergy);
    else assert.deepEqual(p.energy,{gem:1,crystal:0});
    assert.equal(game.winner,null);game.assertCardLocations();
  }
});
