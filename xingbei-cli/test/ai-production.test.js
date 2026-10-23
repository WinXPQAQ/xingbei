import fs from 'node:fs';
import {captureObservation,observationView} from '../src/ai/observation.js';
import {legalActions} from '../src/legal-actions.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/engine.js';
import * as production from '../src/ai.js';
import {getPolicy} from '../src/ai/versions.js';
test('CLI/Web hero preview routes exports to its version and preserves old six-hero decisions',()=>{
 const accepted=getPolicy('experimental/plans-4'),stable=getPolicy('v1.5');
 assert.equal(production.AI_POLICY_VERSION,'v1.7.0-preview.2');
 for(const method of ['chooseAiResponse','chooseAiRuleDecision','chooseAiDiscard','cardScore','keepCards','giftScore','planWindAttacks'])assert.equal(production[method],getPolicy('v1.7.0-preview.2')[method]);
 for(const hero of ['berserker','windSwordmaster','marksman','sealer','guardianAngel','priest']) {
  const g=new Game({seed:123,playerHeroId:hero}).setup();
  assert.deepEqual(production.rankAiActions(g,0),accepted.rankAiActions(g,0));
  assert.deepEqual(production.chooseAiAction(g,0),stable.chooseAiAction(g,0));
  assert.deepEqual(production.chooseAiDiscard(g,0,1),accepted.chooseAiDiscard(g,0,1));
 }
 for(const [stableId,frozenId] of [['v1.1','read-1'],['v1.2','fusion-1'],['v1.3','experimental/economy-4'],['v1.4','experimental/targeted-fixes-1']])assert.equal(getPolicy(stableId).rankAiActions,getPolicy(frozenId).rankAiActions);
 assert.notEqual(stable.rankAiActions,getPolicy('v1.2').rankAiActions);
});

test('v1.5 default exactly matches frozen candidate on 180 fixed legal public observations',()=>{
 const {snapshots}=JSON.parse(fs.readFileSync(new URL('../artifacts/ai/targeted-fixes-1/confirmation/stress-snapshots.json',import.meta.url)));
 const frozen=getPolicy('experimental/plans-4'),stable=getPolicy('v1.5');
 assert.equal(snapshots.length,180);
 for(const {observation,actorId} of snapshots){
  const view=observationView(observation);
  // Reconstitute the public field for the production observation adapter.
  view.field=[...view.cards.values()].filter(c=>c.location.zone==='field');
  assert.deepEqual(captureObservation(view,actorId,{actions:true}),observation);
  const legal=legalActions(view,actorId);
  const expected=frozen.rankAiActions(view,actorId);
  assert.deepEqual(production.rankAiActions(view,actorId),expected);
  assert.deepEqual(stable.rankAiActions(view,actorId),expected);
  const action=production.chooseAiAction(view,actorId);
  assert.deepEqual(action,frozen.chooseAiAction(view,actorId));
  assert(legal.some(a=>JSON.stringify(a)===JSON.stringify(action)));
 }
});
