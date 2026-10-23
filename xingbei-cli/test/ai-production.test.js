import fs from 'node:fs';
import {captureObservation,observationView} from '../src/ai/observation.js';
import {legalActions} from '../src/legal-actions.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/engine.js';
import * as production from '../src/ai.js';
import {getPolicy} from '../src/ai/versions.js';
import {acceptsRefinement} from '../src/heroes/shared/ai/wave-two/refinement.js';
const unchangedActions=(g,id,entries)=>entries.filter(e=>acceptsRefinement(g,id,e.action)&&(e.action.type!=='play'||g.player(id).hand[e.action.index]?.name!=='magicBullet'));
test('CLI/Web hero preview routes exports to its version and preserves old six-hero decisions except revised magic and refinement candidates',()=>{
 const accepted=getPolicy('experimental/plans-4'),stable=getPolicy('v1.5');
 assert.equal(production.AI_POLICY_VERSION,'v1.8.0-preview.1');
 for(const method of ['chooseAiResponse','chooseAiRuleDecision','chooseAiDiscard','cardScore','keepCards','giftScore','planWindAttacks'])assert.equal(production[method],getPolicy('v1.8.0-preview.1')[method]);
 for(const hero of ['berserker','windSwordmaster','marksman','sealer','guardianAngel','priest']) {
  const g=new Game({seed:123,playerHeroId:hero}).setup();
  assert.deepEqual(unchangedActions(g,0,production.rankAiActions(g,0)),unchangedActions(g,0,accepted.rankAiActions(g,0)));
  assert(legalActions(g,0).some(a=>JSON.stringify(a)===JSON.stringify(production.chooseAiAction(g,0))));
  assert.deepEqual(production.chooseAiDiscard(g,0,1),accepted.chooseAiDiscard(g,0,1));
 }
 for(const [stableId,frozenId] of [['v1.1','read-1'],['v1.2','fusion-1'],['v1.3','experimental/economy-4'],['v1.4','experimental/targeted-fixes-1']])assert.equal(getPolicy(stableId).rankAiActions,getPolicy(frozenId).rankAiActions);
 assert.notEqual(stable.rankAiActions,getPolicy('v1.2').rankAiActions);
});

test('frozen v1.5 replay stays unchanged and preview changes only magic and refinement candidates on old heroes',()=>{
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
  assert.deepEqual(unchangedActions(view,actorId,production.rankAiActions(view,actorId)),unchangedActions(view,actorId,expected));
  assert.deepEqual(stable.rankAiActions(view,actorId),expected);
  const action=production.chooseAiAction(view,actorId);
  assert(legal.some(a=>JSON.stringify(a)===JSON.stringify(action)));
 }
});
