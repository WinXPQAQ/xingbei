import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/engine.js';
import {captureObservation,observationView} from '../src/ai/observation.js';
import {getPolicy} from '../src/ai/versions.js';
import {stateOf,clone,cardData,components} from '../src/ai/v1.3/model.js';

const heroes=['berserker','windSwordmaster','marksman','sealer','guardianAngel','priest'];
test('explicit branch clone preserves every modeled value and isolates all mutable containers',()=>{
 const g=new Game({seed:61011,heroIds:heroes}).setup();g.startTurn(0);
 const shield=g.deck.find(c=>c.name==='holyShield');g.attachCard(shield.id,0,{effectId:'holyShield',sourcePlayerId:0});
 g.publicHistory.append({type:'unanswered',playerId:1,elements:['fire'],acceptCost:2});
 const view=observationView(captureObservation(g,0,{actions:true})),s=stateOf(view,0);
 s.players[3].known.push(cardData(view.player(0).hand[0]));
 s.turn.pendingActions=[{type:'attack',element:'wind'}];s.turn.usedSkills={windFury:true};
 const before=structuredClone(s),branch=clone(s),sibling=clone(s);
 assert.deepEqual(branch,before);assert.deepEqual(components(branch),components(before));
 const compare=(a,b,path='')=>{
  if(!a||typeof a!=='object')return;
  if(a===b){assert.ok(Object.isFrozen(a),`Shared mutable object: ${path}`);for(const [k,v]of Object.entries(a))if(v&&typeof v==='object')compare(v,b[k],`${path}.${k}`);return;}
  for(const [k,v]of Object.entries(a))compare(v,b[k],`${path}.${k}`);
 };
 compare(s,branch);
 branch.players[0].hand[0].elements.push('test');branch.players[0].hand[0].uniqueSkills.push('test');
 branch.players[0].energy.gem=99;branch.players[0].healing=99;
 branch.players[0].effects[0].card.elements.push('test');branch.players[0].effects[0].name='test';
 branch.players[3].known[0].elements.push('test');branch.teams.red.morale=99;
 branch.turn.pendingActions[0].element='test';branch.turn.usedSkills.windFury=false;
 assert.deepEqual(s,before);assert.deepEqual(sibling,before);
 const original=view.player(0).hand[0].traits,traits=s.players[0].hand[0].traits;
 assert.notEqual(traits,original);assert.notEqual(stateOf(view,0).players[0].hand[0].traits,traits);
 assert.throws(()=>traits[0].elements.push('test'),TypeError);
 original[0].elements.push('view-only');assert.ok(!traits[0].elements.includes('view-only'));
 assert.ok(!g.player(0).hand[0].elements.includes('test'));
});

test('optimized clone leaves action scores identical to frozen economy-2 across six observers',()=>{
 const before=getPolicy('experimental/economy-2'),after=getPolicy('experimental/economy-3');
 for(let id=0;id<6;id++) {
  const g=new Game({seed:61011+id,heroIds:heroes}).setup();g.startTurn(id);g.player(id).energy.crystal=2;
  const poison=g.deck.find(c=>c.name==='poison');g.attachCard(poison.id,(id+1)%6,{effectId:'poison',sourcePlayerId:id});
  g.publicHistory.append({type:'unanswered',playerId:(id+1)%6,elements:['fire'],acceptCost:2});
  assert.deepEqual(after.rankAiActions(g,id),before.rankAiActions(g,id),`observer ${id}`);
 }
});
