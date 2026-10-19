import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/engine.js';
import * as production from '../src/ai.js';
import {getPolicy} from '../src/ai/versions.js';
test('CLI/Web shared default routes every exported decision to accepted v1.3 while old aliases remain explicit',()=>{
 const accepted=getPolicy('experimental/economy-4'),stable=getPolicy('v1.3');
 assert.equal(production.AI_POLICY_VERSION,'v1.3');
 for(const method of ['chooseAiResponse','chooseAiRuleDecision','chooseAiDiscard','cardScore','keepCards','giftScore','planWindAttacks'])assert.equal(production[method],accepted[method]);
 for(const hero of ['berserker','windSwordmaster','marksman','sealer','guardianAngel','priest']) {
  const g=new Game({seed:123,playerHeroId:hero}).setup();
  assert.deepEqual(production.rankAiActions(g,0),accepted.rankAiActions(g,0));
  assert.deepEqual(production.chooseAiAction(g,0),stable.chooseAiAction(g,0));
  assert.deepEqual(production.chooseAiDiscard(g,0,1),accepted.chooseAiDiscard(g,0,1));
 }
 for(const [stableId,frozenId] of [['v1.1','read-1'],['v1.2','fusion-1']])assert.equal(getPolicy(stableId).rankAiActions,getPolicy(frozenId).rankAiActions);
 assert.notEqual(stable.rankAiActions,getPolicy('v1.2').rankAiActions);
});
